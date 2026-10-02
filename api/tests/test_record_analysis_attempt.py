"""A5: a recording's analysis audio becomes Attempt(kind=record), server-side (docs/features/13 A5)."""

# ruff: noqa: F811  (pytest fixtures are imported and then requested by parameter name)

import pytest

from twisters.media import processing
from twisters.models import (
    AcousticModelVersion,
    Attempt,
    AttemptWord,
    MediaAsset,
    MediaJob,
    Profile,
    Recording,
    ScoringJob,
)
from twisters.speak import record_jobs
from twisters.speak.normalise import tokenise

from .media_helpers import API, WAV, signed_post
from .test_media_jobs import analysable, analyse  # noqa: F401  (fixture)
from .test_media_jobs import claim as media_claim
from .test_speak_trust import model  # noqa: F401  (fixture)


@pytest.fixture(autouse=True)
def _worker_secret(settings):
    settings.WORKER_SHARED_SECRET = "worker-secret"


@pytest.fixture
def scoring(analysable, model, settings, anon, storage):  # noqa: F811
    """A consenting owner with record scoring on, whose analysis audio has just been produced."""
    settings.RECORD_SCORING_ENABLED = True
    settings.WORKER_SHARED_SECRET = "worker-secret"
    client, profile, rec = analysable
    assert analyse(client, rec.pk).status_code == 202
    audio_ready(anon, storage, rec)
    return client, profile, Recording.objects.get(pk=rec.pk)


def audio_ready(anon, storage, rec):
    job = media_claim(anon).data["job"]
    db_job = MediaJob.objects.get(pk=job["id"])
    storage.simulate_upload("voice", processing.output_path(db_job, "audio"), WAV + bytes(3 << 20))
    done = signed_post(
        anon,
        f"/internal/media/{job['asset_id']}/processed/",
        {"status": "ready", "job_id": str(job["id"]), "outputs": ["audio"]},
    )
    assert done.status_code == 200, done.data


def claim_record(anon):
    return signed_post(anon, "/internal/scoring-jobs/claim/", {"worker_id": "w1"}).data["job"]


def post_result(anon, job_id, body):
    return signed_post(anon, f"/internal/scoring-jobs/{job_id}/result/", body)


def words_for(rec, status="correct"):
    return [
        {
            "i": i,
            "target": t,
            "status": status,
            "start_ms": i * 300,
            "end_ms": i * 300 + 250,
            "phonemes": [{"t": "S", "verdict": "ok", "start_ms": i * 300, "end_ms": i * 300 + 100}],
        }
        for i, t in enumerate(tokenise(rec.twister.text))
    ]


def good(rec, **over):
    return {
        "status": "done",
        "score": 88,
        "duration_ms": 6000,
        "words": words_for(rec),
        "model_sha256": "a" * 64,
        "engine_version": "e-test",
        "quality": {"snr_db": 24.0, "ok": True},
        "latency_ms": 900,
        **over,
    }


# --- queueing ------------------------------------------------------------------------------------


def test_a_ready_analysis_queues_one_record_job(scoring):
    _, _, rec = scoring
    job = ScoringJob.objects.get(recording=rec)
    assert job.kind == "record" and job.attempt_id is None
    assert job.audio_asset_id == rec.audio_asset_id and job.status == "queued"
    assert record_jobs.block(rec) == {"status": "queued", "reason": ""}


def test_nothing_is_queued_while_the_switch_is_off(analysable, model, settings, anon, storage):  # noqa: F811
    settings.RECORD_SCORING_ENABLED = False
    client, _, rec = analysable
    analyse(client, rec.pk)
    audio_ready(anon, storage, rec)
    assert not ScoringJob.objects.filter(recording=rec).exists()
    assert client.get(f"{API}/recordings/{rec.pk}/").data["analysis"]["scoring"]["status"] == "none"


def test_nothing_is_queued_without_a_published_model(analysable, settings, anon, storage):  # noqa: F811
    settings.RECORD_SCORING_ENABLED = True
    client, _, rec = analysable
    analyse(client, rec.pk)
    audio_ready(anon, storage, rec)
    assert not ScoringJob.objects.exists()


def test_a_take_that_already_has_an_attempt_is_never_scored_again(
    analysable,
    model,
    settings,
    anon,
    storage,  # noqa: F811
):
    settings.RECORD_SCORING_ENABLED = True
    client, profile, rec = analysable
    attempt = Attempt.objects.create(
        profile=profile,
        twister=rec.twister,
        kind="record",
        transcript="x",
        accuracy=80,
        speed_score=80,
        fluency_score=80,
        completeness=80,
        duration_ms=4000,
        wpm=100,
        score=80,
        xp_awarded=10,
    )
    Recording.objects.filter(pk=rec.pk).update(attempt=attempt)
    analyse(client, rec.pk)
    audio_ready(anon, storage, rec)
    assert not ScoringJob.objects.exists()  # no double XP with the client-side attempt
    assert client.get(f"{API}/recordings/{rec.pk}/").data["analysis"]["scoring"]["status"] == "none"


def test_a_too_long_take_is_not_queued_and_says_why(scoring, settings):
    _, _, rec = scoring
    ScoringJob.objects.all().delete()
    settings.SCORING_MAX_AUDIO_S = 10
    assert record_jobs.enqueue(Recording.objects.get(pk=rec.pk)) is None
    assert record_jobs.block(rec) == {"status": "none", "reason": "too_long"}


def test_enqueue_is_idempotent(scoring):
    _, _, rec = scoring
    assert record_jobs.enqueue(Recording.objects.get(pk=rec.pk)) is None
    assert ScoringJob.objects.filter(recording=rec).count() == 1


def test_asking_to_analyse_again_after_the_switch_is_turned_on_queues_scoring(
    analysable,
    model,
    settings,
    anon,
    storage,  # noqa: F811
):
    settings.RECORD_SCORING_ENABLED = False
    client, _, rec = analysable
    analyse(client, rec.pk)
    audio_ready(anon, storage, rec)
    settings.RECORD_SCORING_ENABLED = True
    assert analyse(client, rec.pk).status_code == 200
    assert ScoringJob.objects.filter(recording=rec, kind="record").count() == 1


# --- the claim -----------------------------------------------------------------------------------


def test_the_worker_claims_a_record_job_without_identity(scoring, anon):
    _, profile, rec = scoring
    job = claim_record(anon)
    assert job["kind"] == "record"
    assert job["attempt"]["id"] == str(rec.pk) and job["attempt"]["audio_sha256"] is None
    assert job["device_words"] == [] and job["twister"]["words"]
    text = str(job)
    assert profile.email not in text and str(profile.pk) not in text


def test_withdrawn_consent_stops_the_claim(scoring, anon):
    _, profile, _ = scoring
    profile.consents.update(revoked_at=profile.consents.first().granted_at)
    assert claim_record(anon) is None
    assert ScoringJob.objects.get().status == "expired"


# --- the result ----------------------------------------------------------------------------------


def test_a_good_result_creates_the_record_attempt_and_links_it(scoring, anon):
    client, profile, rec = scoring
    job = claim_record(anon)
    r = post_result(anon, job["id"], good(rec))
    assert r.status_code == 200 and r.data["status"] == "done"
    rec.refresh_from_db()
    attempt = rec.attempt
    assert attempt is not None and attempt.kind == "record" and attempt.engine == "worker"
    assert attempt.verification_status == "verified" and attempt.verified_at is not None
    assert attempt.client_attempt_id == record_jobs.client_attempt_id(rec)
    assert attempt.model_version.sha256 == "a" * 64 and attempt.scoring_profile.code == "sp-test"
    assert attempt.duration_ms == 6000 and attempt.score > 0 and attempt.xp_awarded > 0
    assert AttemptWord.objects.filter(attempt=attempt).count() == len(tokenise(rec.twister.text))
    assert Profile.objects.get(pk=profile.pk).xp >= attempt.xp_awarded  # plus any first-time badges
    detail = client.get(f"{API}/recordings/{rec.pk}/").data
    assert detail["attempt"]["id"] == attempt.pk
    assert detail["analysis"]["scoring"] == {"status": "scored", "reason": ""}


def test_the_analysis_audio_is_kept_after_scoring(scoring, anon):
    _, _, rec = scoring
    job = claim_record(anon)
    post_result(anon, job["id"], good(rec))
    asset = MediaAsset.objects.get(pk=rec.audio_asset_id)
    assert asset.status == "ready"


def test_a_repeated_result_changes_nothing(scoring, anon):
    _, profile, rec = scoring
    job = claim_record(anon)
    post_result(anon, job["id"], good(rec))
    xp = Profile.objects.get(pk=profile.pk).xp
    again = post_result(anon, job["id"], good(rec))
    assert again.headers["Idempotent-Replay"] == "true"
    assert Attempt.objects.filter(kind="record").count() == 1
    assert Profile.objects.get(pk=profile.pk).xp == xp


def test_a_result_for_a_take_the_client_linked_meanwhile_makes_no_second_attempt(scoring, anon):
    _, profile, rec = scoring
    job = claim_record(anon)
    attempt = Attempt.objects.create(
        profile=profile,
        twister=rec.twister,
        kind="record",
        transcript="x",
        accuracy=50,
        speed_score=50,
        fluency_score=50,
        completeness=50,
        duration_ms=4000,
        wpm=90,
        score=50,
    )
    Recording.objects.filter(pk=rec.pk).update(attempt=attempt)
    post_result(anon, job["id"], good(rec))
    assert Attempt.objects.filter(kind="record").count() == 1
    assert ScoringJob.objects.get(pk=job["id"]).error_code == "attempt_exists"


@pytest.mark.parametrize("reason", ["no_speech", "low_quality", "could_not_follow"])
def test_an_inconclusive_clip_ends_without_an_attempt_and_says_why(scoring, anon, reason):
    client, _, rec = scoring
    job = claim_record(anon)
    r = post_result(anon, job["id"], {"status": "done", "unscorable": reason, "words": []})
    assert r.status_code == 200
    assert not Attempt.objects.filter(kind="record").exists()
    scoring_block = client.get(f"{API}/recordings/{rec.pk}/").data["analysis"]["scoring"]
    assert scoring_block == {"status": "unscorable", "reason": reason}


def test_words_that_do_not_describe_the_twister_fail_the_job_for_good(scoring, anon):
    _, _, rec = scoring
    job = claim_record(anon)
    bad = words_for(rec)
    bad[0]["target"] = "banana"
    post_result(anon, job["id"], good(rec, words=bad))
    db = ScoringJob.objects.get(pk=job["id"])
    assert db.status == "failed" and db.error_code == "result_invalid"
    assert not Attempt.objects.filter(kind="record").exists()


@pytest.mark.parametrize(
    "patch",
    [
        {"duration_ms": 10},
        {"duration_ms": "6000"},
        {"duration_ms": 10_000_000},
        {"words": "nope"},
        {"words": [{"i": 0, "target": "she", "status": "extra"}]},
        {"engine_version": "x" * 41},
    ],
)
def test_malformed_results_are_rejected_and_change_nothing(scoring, anon, patch):
    _, _, rec = scoring
    job = claim_record(anon)
    r = post_result(anon, job["id"], good(rec, **patch))
    assert r.status_code == 400
    assert ScoringJob.objects.get(pk=job["id"]).status == "running"
    assert not Attempt.objects.filter(kind="record").exists()


def test_a_different_model_hash_is_inconclusive(scoring, anon):
    _, _, rec = scoring
    job = claim_record(anon)
    post_result(anon, job["id"], good(rec, model_sha256="b" * 64))
    assert ScoringJob.objects.get(pk=job["id"]).error_code == "model_mismatch"
    assert not Attempt.objects.filter(kind="record").exists()


def test_a_failed_job_retries_then_gives_up_without_purging_the_audio(scoring, anon, settings):
    _, _, rec = scoring
    for _ in range(settings.SCORING_JOB_MAX_TRIES):
        job = claim_record(anon)
        post_result(anon, job["id"], {"status": "failed", "error_code": "boom"})
    db = ScoringJob.objects.get()
    assert db.status == "failed" and db.error_code == "boom"
    assert MediaAsset.objects.get(pk=rec.audio_asset_id).status == "ready"
    assert record_jobs.block(Recording.objects.get(pk=rec.pk)) == {
        "status": "failed",
        "reason": "boom",
    }


def test_a_deleted_recording_is_not_scored(scoring, anon):
    _, _, rec = scoring
    job = claim_record(anon)
    Recording.objects.filter(pk=rec.pk).update(status="deleted")
    post_result(anon, job["id"], good(rec))
    assert ScoringJob.objects.get(pk=job["id"]).error_code == "recording_gone"
    assert not Attempt.objects.filter(kind="record").exists()


def test_a_retired_model_expires_a_queued_job(scoring):
    from twisters.speak import jobs

    AcousticModelVersion.objects.update(active=False)
    jobs.sweep()
    job = ScoringJob.objects.get()
    assert job.status == "expired" and job.error_code == "model_retired"


def test_the_one_subject_constraint_holds(scoring, model):  # noqa: F811
    from django.db import IntegrityError, transaction

    with pytest.raises(IntegrityError), transaction.atomic():
        ScoringJob.objects.create(kind="record", model_version=model)
