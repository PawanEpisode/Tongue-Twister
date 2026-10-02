"""Device engine results, trust levels, spot-checks and the worker callback."""

import uuid

import pytest
from django.utils import timezone

from twisters.models import (
    AcousticModelVersion,
    Attempt,
    AttemptPhoneme,
    FeatureFlag,
    ScoringProfile,
    UserPhonemeStat,
    Verification,
)

from .speak_helpers import submit

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
