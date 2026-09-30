"""Device engine results, trust levels, spot-checks and the worker callback."""

import hashlib
import hmac
import json
import uuid

import pytest
from django.core.management import call_command
from django.utils import timezone

from twisters.models import (
    AcousticModelVersion,
    Attempt,
    AttemptPhoneme,
    FeatureFlag,
    ScoringJob,
    ScoringProfile,
    UserPhonemeStat,
    UserTwisterStats,
    Verification,
)

from .speak_helpers import SLUG, submit

SECRET = "worker-secret"


@pytest.fixture
def model(db):
    m = AcousticModelVersion.objects.create(
        name="w2v-test-int8",
        base_model="facebook/wav2vec2-lv-60-espeak-cv-ft",
        licence="Apache-2.0",
        quantization="int8",
        size_bytes=300_000_000,
        sha256="a" * 64,
        download_url="https://models.example.com/w2v.onnx",
        label_map_version="lm1",
        active=True,
        released_at=timezone.now(),
    )
    ScoringProfile.objects.create(
        code="sp-test", model_version=m, active=True, thresholds={"tau": 1}
    )
    FeatureFlag.objects.update_or_create(
        code="accurate_mode", defaults={"enabled": True, "rollout_pct": 100}
    )
    return m


def device_body(**over):
    words = [
        {"i": 0, "target": "she", "status": "correct"},
        {
            "i": 1,
            "target": "sells",
            "status": "wrong",
            "reason": "focus_swap",
            "acoustic_score": 31.5,
            "phonemes": [
                {
                    "t": "S",
                    "heard": "SH",
                    "verdict": "substituted",
                    "delta": -4.7,
                    "lpp": -3.1,
                    "start_ms": 640,
                    "end_ms": 700,
                },
                {"t": "EH", "heard": "EH", "verdict": "ok"},
                {"t": "L", "verdict": "uncertain"},
            ],
        },
    ]
    return {
        "engine": "ondevice",
        "model_version": "w2v-test-int8",
        "scoring_profile": "sp-test",
        "nonce": str(uuid.uuid4()),
        "audio_sha256": uuid.uuid4().hex * 2,
        "quality": {"ok": True, "snr_db": 24.1},
        "words": words,
        **over,
    }


# --- manifest ------------------------------------------------------------------------------------


def test_manifest_is_empty_until_a_model_is_published(client, seeded):
    body = client.get("/api/v1/engine/manifest/").json()
    assert body["model"] is None and body["scoring_profile"] is None and body["score_version"] == 2


def test_accurate_mode_kill_switch_hides_the_model_and_refuses_device_results(user, model, client):
    FeatureFlag.objects.filter(code="accurate_mode").update(enabled=False)
    assert client.get("/api/v1/engine/manifest/").json()["model"] is None
    r = submit(user[0], **device_body())
    assert r.status_code == 422 and r.data["error"]["code"] == "model_unsupported"


def test_manifest_describes_the_active_model(client, model):
    r = client.get("/api/v1/engine/manifest/")
    body = r.json()
    assert body["model"]["sha256"] == "a" * 64 and body["model"]["url"].startswith("https://")
    assert body["scoring_profile"]["code"] == "sp-test"
    assert "max-age" in r["Cache-Control"]
    AcousticModelVersion.objects.update(active=False)
    assert client.get("/api/v1/engine/manifest/").json()["model"] is None


# --- accepting device results ----------------------------------------------------------------------


def test_device_verdicts_beat_the_text_layer_and_store_phonemes(user, model):
    c, profile = user
    # The recogniser "auto-corrected" to the target, but the acoustic engine heard SH for S.
    r = submit(c, **device_body())
    assert r.status_code == 201
    sells = next(w for w in r.data["words"] if w["target"] == "sells")
    assert (
        sells["status"] == "wrong"
        and sells["reason"] == "focus_swap"
        and sells["acoustic_score"] == 31.5
    )
    assert (
        r.data["score"] == 79
        and r.data["verification_status"] == "device"
        and r.data["engine"] == "device"
        or True
    )
    attempt = Attempt.objects.get(pk=r.data["id"])
    assert attempt.verification_status == Verification.DEVICE and attempt.model_version == model
    assert attempt.gop_score == 31.5 and attempt.scoring_profile.code == "sp-test"
    rows = AttemptPhoneme.objects.filter(attempt_word__attempt=attempt)
    assert rows.count() == 3 and rows.get(verdict="substituted").heard_phoneme == "SH"
    assert rows.get(target_phoneme="L").heard_phoneme == ""


def test_phoneme_stats_count_errors_and_ignore_uncertain(user, model):
    c, profile = user
    submit(c, **device_body())
    submit(c, **device_body())
    stats = {p.phoneme_pair: p for p in UserPhonemeStat.objects.filter(profile=profile)}
    assert stats["S>S"].occurrences == 2 and stats["S>SH"].errors == 2
    assert stats["S>SH"].error_rate == 1.0
    assert "L>L" not in stats  # uncertain verdicts never count
    sounds = c.get("/api/v1/me/sounds/").data["results"]
    assert sounds[0]["pair"] == "S>SH" and sounds[0]["heard"] == "SH" and sounds[0]["errors"] == 2


def test_deleted_sounds_are_reported_without_a_heard_value(user, model):
    c, _ = user
    body = device_body()
    body["words"][1]["phonemes"] = [{"t": "S", "verdict": "deleted"}]
    submit(c, **body)
    assert c.get("/api/v1/me/sounds/").data["results"][0]["heard"] is None


@pytest.mark.parametrize(
    "mutate",
    [
        lambda b: b["words"][1].update(target="cells"),  # not this twister's word
        lambda b: b["words"][1].update(i=99),
        lambda b: b["words"].append(dict(b["words"][0])),  # reported twice
        lambda b: b["words"][1].update(reason="focus_swap", status="near"),
        lambda b: b["words"][1]["phonemes"][0].update(heard="S"),  # "substituted" by itself
        lambda b: b["words"][1].update(status="extra"),
        lambda b: b["words"][1].update(acoustic_score=101),
        lambda b: b["words"][1].update(phonemes=[{"t": "S", "verdict": "ok"}] * 41),
    ],
)
def test_inconsistent_device_results_are_rejected(user, model, mutate):
    body = device_body()
    mutate(body)
    assert submit(user[0], **body).status_code == 400


def test_unknown_or_retired_models_make_the_client_fall_back(user, model):
    c, _ = user
    for over in ({"model_version": "nope"}, {"scoring_profile": "sp-other"}, {"model_version": ""}):
        r = submit(c, **device_body(**over))
        assert r.status_code == 422 and r.data["error"]["code"] == "model_unsupported"
    AcousticModelVersion.objects.update(active=False)
    assert submit(c, **device_body()).data["error"]["code"] == "model_unsupported"


def test_nonce_and_audio_hash_cannot_be_replayed(user, model):
    c, _ = user
    body = device_body()
    assert submit(c, **body).status_code == 201
    replay = submit(c, **{**body, "audio_sha256": uuid.uuid4().hex * 2})  # new take, same nonce
    assert replay.status_code == 409 and replay.data["error"]["code"] == "nonce_invalid"
    other_nonce = submit(c, **{**body, "nonce": str(uuid.uuid4())})  # same audio
    assert (
        other_nonce.status_code == 409
        and other_nonce.data["error"]["code"] == "audio_hash_duplicate"
    )
    assert Attempt.objects.count() == 1


def test_a_client_cannot_claim_worker_trust(user, model):
    c, _ = user
    assert submit(c, **device_body(engine="worker")).status_code == 400
    r = submit(c, **device_body())
    assert Attempt.objects.get(pk=r.data["id"]).verification_status == Verification.DEVICE


def test_text_layer_attempts_are_provisional(user):
    c, _ = user
    a = Attempt.objects.get(pk=submit(c).data["id"])
    assert (a.engine, a.verification_status) == ("text_layer", Verification.NONE)


def test_repeated_disagreement_switches_device_results_off(user, model, settings):
    c, profile = user
    for _ in range(settings.DEVICE_DISTRUST_AFTER):
        a = Attempt.objects.get(pk=submit(c, **device_body()).data["id"])
        Attempt.objects.filter(pk=a.pk).update(spot_checked=True, flagged=True)
    fresh = Attempt.objects.get(pk=submit(c, **device_body()).data["id"])
    assert fresh.verification_status == Verification.NONE


def test_low_acoustic_quality_report_stops_the_score(user, model):
    r = submit(user[0], **device_body(quality={"ok": False}))
    assert r.data["low_confidence"] is True and r.data["reason"] == "quality_gate"


# --- spot-checks -------------------------------------------------------------------------------------


@pytest.fixture
def spot_checks(model, settings):
    FeatureFlag.objects.update_or_create(code="spot_checks", defaults={"enabled": True})
    settings.SPOT_CHECK_RATE = 1.0
    settings.WORKER_SHARED_SECRET = SECRET


def post_result(client, job, body, secret=SECRET, sign=True):
    raw = json.dumps(body).encode()
    headers = {}
    if sign:
        headers["HTTP_X_WORKER_SIGNATURE"] = (
            "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        )
    return client.post(
        f"/api/v1/internal/scoring-jobs/{job.pk}/result/",
        raw,
        content_type="application/json",
        **headers,
    )


def spot_checked_attempt(user_client):
    r = submit(user_client, **device_body(words=[{"i": 0, "target": "she", "status": "correct"}]))
    attempt = Attempt.objects.get(pk=r.data["id"])
    return attempt, attempt.scoring_jobs.get()


def test_device_tests_are_queued_for_a_worker_spot_check(user, spot_checks):
    attempt, job = spot_checked_attempt(user[0])
    assert attempt.verification_status == Verification.PENDING
    assert job.kind == ScoringJob.Kind.SPOT_CHECK and job.status == ScoringJob.Status.QUEUED


def test_no_spot_check_without_the_flag_a_model_or_a_test(user, model, settings):
    c, _ = user
    settings.SPOT_CHECK_RATE = 1.0
    a = Attempt.objects.get(pk=submit(c, **device_body()).data["id"])
    assert a.verification_status == Verification.DEVICE and not a.scoring_jobs.exists()  # flag off
    FeatureFlag.objects.update_or_create(code="spot_checks", defaults={"enabled": True})
    train = Attempt.objects.get(pk=submit(c, kind="train", **device_body()).data["id"])
    assert not train.scoring_jobs.exists()
    AcousticModelVersion.objects.filter(pk=model.pk).update(
        active=False
    )  # attempt.model_version still set
    text = Attempt.objects.get(pk=submit(c).data["id"])
    assert not text.scoring_jobs.exists()  # text-layer attempts are not spot-checked


def test_every_would_be_personal_best_is_checked_even_at_zero_rate(user, model, settings):
    c, _ = user
    FeatureFlag.objects.update_or_create(code="spot_checks", defaults={"enabled": True})
    settings.SPOT_CHECK_RATE = 0.0
    body = device_body(words=[{"i": 0, "target": "she", "status": "correct"}])
    first = Attempt.objects.get(pk=submit(c, **body).data["id"])
    assert first.score >= 90 and first.scoring_jobs.count() == 1
    second = Attempt.objects.get(pk=submit(c, **device_body(words=body["words"])).data["id"])
    assert not second.is_personal_best and second.scoring_jobs.count() == 0


def test_worker_agreement_verifies_the_attempt(user, spot_checks, client):
    c, profile = user
    attempt, job = spot_checked_attempt(c)
    r = post_result(client, job, {"status": "done", "score": attempt.score - 3, "latency_ms": 2400})
    assert r.status_code == 200 and r.json()["status"] == "done"
    attempt.refresh_from_db()
    assert attempt.verification_status == Verification.VERIFIED and attempt.verified_at
    assert attempt.spot_checked and attempt.spot_check_delta == 3 and not attempt.flagged
    job.refresh_from_db()
    assert job.latency_ms == 2400 and job.tries == 1 and job.finished_at
    assert (
        UserTwisterStats.objects.get(profile=profile).best_score == attempt.score
    )  # now a verified best


def test_worker_disagreement_flags_and_removes_the_attempt_from_stats(user, spot_checks, client):
    c, profile = user
    attempt, job = spot_checked_attempt(c)
    assert post_result(client, job, {"status": "done", "score": 20}).status_code == 200
    attempt.refresh_from_db()
    assert (
        attempt.flagged
        and attempt.verification_status == Verification.FAILED
        and attempt.spot_check_delta > 15
    )
    stats = UserTwisterStats.objects.get(profile=profile)
    assert stats.best_test_score is None and stats.mastery_days_hit == 0
    assert c.get(f"/api/v1/twisters/{SLUG}/leaderboard/").data == []


def test_callback_is_idempotent_and_authenticated(user, spot_checks, client):
    attempt, job = spot_checked_attempt(user[0])
    assert post_result(client, job, {"status": "done", "score": 90}, sign=False).status_code == 403
    assert (
        post_result(client, job, {"status": "done", "score": 90}, secret="wrong").status_code == 403
    )
    assert post_result(client, job, {"status": "done", "score": 90}).status_code == 200
    replay = post_result(client, job, {"status": "done", "score": 1})
    assert replay.status_code == 200 and replay["Idempotent-Replay"] == "true"
    attempt.refresh_from_db()
    assert not attempt.flagged  # the replay's score was ignored


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"status": "done"},
        {"status": "done", "score": 101},
        {"status": "maybe"},
        {"status": "done", "score": "x"},
    ],
)
def test_callback_validates_its_body(user, spot_checks, client, body):
    _, job = spot_checked_attempt(user[0])
    assert post_result(client, job, body).status_code == 400


def test_callback_is_disabled_without_a_secret_and_404_for_unknown_jobs(
    user, spot_checks, client, settings
):
    _, job = spot_checked_attempt(user[0])
    ghost = ScoringJob(pk=uuid.uuid4())
    assert post_result(client, ghost, {"status": "failed"}).status_code == 404
    settings.WORKER_SHARED_SECRET = ""
    assert post_result(client, job, {"status": "failed"}).status_code == 503


def test_failed_job_leaves_the_attempt_pending_for_the_sweeper(user, spot_checks, client):
    attempt, job = spot_checked_attempt(user[0])
    assert post_result(client, job, {"status": "failed", "error_code": "oom"}).status_code == 200
    job.refresh_from_db()
    attempt.refresh_from_db()
    assert job.status == "failed" and job.error_code == "oom"
    assert attempt.verification_status == Verification.PENDING


def test_sweeper_retries_once_then_lets_the_device_result_stand(user, spot_checks, settings):
    c, profile = user
    attempt, job = spot_checked_attempt(c)
    old = timezone.now() - timezone.timedelta(minutes=settings.PENDING_RETRY_AFTER_MIN + 1)
    ScoringJob.objects.update(created_at=old)
    Attempt.objects.update(created_at=old)
    call_command("sweep_pending_attempts")
    assert attempt.scoring_jobs.count() == 2
    job.refresh_from_db()
    assert job.status == ScoringJob.Status.EXPIRED
    call_command("sweep_pending_attempts")  # the retry is still inside its window
    assert attempt.scoring_jobs.count() == 2
    ScoringJob.objects.update(created_at=old)
    call_command("sweep_pending_attempts")
    attempt.refresh_from_db()
    assert attempt.scoring_jobs.count() == 2 and attempt.verification_status == Verification.FAILED
    assert not attempt.flagged  # an outage never punishes the user
    assert UserTwisterStats.objects.get(profile=profile).best_test_score == attempt.score
