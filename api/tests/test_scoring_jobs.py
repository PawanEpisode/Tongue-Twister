"""Server-verified spot-checks: audio request, scoring-job queue, worker callback, sweeper (docs/features/13)."""

import datetime as dt

import pytest
from django.conf import settings
from django.utils import timezone

from twisters.models import (
    AcousticModelVersion,
    AgeBand,
    Attempt,
    ConsentType,
    FeatureFlag,
    MediaAsset,
    Profile,
    ScoringJob,
    ScoringProfile,
    UserConsent,
    Verification,
)
from twisters.speak import jobs

from .media_helpers import API, WEBM, error_code, put_upload, sha256, signed_post
from .speak_helpers import submit
from .test_speak_trust import device_body, model  # noqa: F401  (fixture)

QUEUED, RUNNING, DONE, FAILED = "queued", "running", "done", "failed"


@pytest.fixture
def spot(user, model, settings):  # noqa: F811
    """A consenting adult with spot-checks on and every device result requested for a check."""
    client, profile = user
    FeatureFlag.objects.update_or_create(code="spot_checks", defaults={"enabled": True})
    settings.SPOT_CHECK_RATE = 1.0
    settings.WORKER_SHARED_SECRET = "worker-secret"
    Profile.objects.filter(pk=profile.pk).update(age_band=AgeBand.ADULT)
    UserConsent.objects.create(
        profile=profile,
        type=ConsentType.VOICE_PROCESSING,
        version=settings.CONSENT_VERSIONS[ConsentType.VOICE_PROCESSING],
    )
    profile.refresh_from_db()
    return client, profile


def requested_attempt(client, *, score=95.0, data=WEBM, **over):
    """A device-scored attempt (hash = WEBM) that the server wants audio for."""
    r = submit(client, **device_body(audio_sha256=sha256(data), duration_ms=4000, **over))
    assert r.status_code in (200, 201), r.data
    attempt = Attempt.objects.get(pk=r.data["id"])
    Attempt.objects.filter(pk=attempt.pk).update(score=score)
    attempt.refresh_from_db()
    return attempt


def upload_clip(client, storage, attempt, *, data=WEBM, duration_ms=4000, **create):
    r = client.post(
        f"{API}/voice/",
        {
            "mime_type": "audio/webm",
            "size_bytes": len(data),
            "duration_ms": duration_ms,
            "purpose": "spot_check",
            "attempt": attempt.pk,
            **create,
        },
        format="json",
    )
    if r.status_code != 201:
        return r, None
    put_upload(storage, r, data)
    done = client.post(
        f"{API}/voice/{r.data['voice_asset_id']}/complete/",
        {"checksum_sha256": sha256(data)},
        format="json",
    )
    assert done.status_code in (200, 202), done.data
    return r, r.data["voice_asset_id"]


def attach(client, attempt, asset_id):
    return client.post(
        f"{API}/attempts/{attempt.pk}/spot-check-audio/",
        {"voice_asset_id": asset_id},
        format="json",
    )


@pytest.fixture
def queued(spot, storage):
    client, profile = spot
    attempt = requested_attempt(client)
    _, asset_id = upload_clip(client, storage, attempt)
    r = attach(client, attempt, asset_id)
    assert r.status_code == 202, r.data
    return client, profile, attempt, ScoringJob.objects.get(attempt=attempt)


def claim(worker_id="w1", **kw):
    return signed_post(kw.pop("client"), "/internal/scoring-jobs/claim/", {"worker_id": worker_id})


def result(client, job, body, **kw):
    return signed_post(client, f"/internal/scoring-jobs/{job.pk}/result/", body, **kw)


def settled(job):
    job.refresh_from_db()
    job.attempt.refresh_from_db()
    return job, job.attempt


GOOD_WORDS = [{"i": 0, "status": "correct", "reason": ""}]


# --- audio request -----------------------------------------------------------------------------------


def test_a_device_result_asks_for_audio_instead_of_creating_a_job(spot):
    attempt = requested_attempt(spot[0])
    assert attempt.spot_check_requested_at is not None
    assert attempt.verification_status == Verification.DEVICE
    assert not ScoringJob.objects.filter(attempt=attempt).exists()


def test_the_result_tells_the_client_a_clip_is_wanted(spot):
    r = submit(spot[0], **device_body(audio_sha256=sha256(WEBM)))
    assert r.data["spot_check"]["requested"] is True


def test_nothing_is_requested_while_the_kill_switch_is_off(user, model, settings):  # noqa: F811
    settings.SPOT_CHECK_RATE = 1.0
    FeatureFlag.objects.update_or_create(code="spot_checks", defaults={"enabled": False})
    assert requested_attempt(user[0]).spot_check_requested_at is None


def test_audio_cannot_be_sent_without_a_request(spot, storage):
    client, _ = spot
    attempt = requested_attempt(client)
    Attempt.objects.filter(pk=attempt.pk).update(spot_check_requested_at=None)
    r, _ = upload_clip(client, storage, attempt)
    assert r.status_code == 409 and error_code(r) == "no_request"


@pytest.mark.parametrize("age,consent", [(AgeBand.UNDER13, True), (AgeBand.ADULT, False)])
def test_minors_and_unconsented_users_cannot_send_audio(spot, storage, age, consent):
    client, profile = spot
    attempt = requested_attempt(client)
    Profile.objects.filter(pk=profile.pk).update(age_band=age)
    if not consent:
        UserConsent.objects.filter(profile=profile).delete()
    r, _ = upload_clip(client, storage, attempt)
    assert r.status_code in (403, 409) and r.status_code != 201


def test_another_users_attempt_is_a_404(spot, storage, auth_client):
    attempt = requested_attempt(spot[0])
    other = auth_client()
    other.get(f"{API}/me/")
    r, _ = upload_clip(other, storage, attempt)
    assert r.status_code in (403, 404)


def test_an_expired_request_is_refused(spot, storage):
    client, _ = spot
    attempt = requested_attempt(client)
    stale = timezone.now() - dt.timedelta(minutes=settings.SPOT_CHECK_AUDIO_WINDOW_MIN + 1)
    Attempt.objects.filter(pk=attempt.pk).update(spot_check_requested_at=stale)
    r, _ = upload_clip(client, storage, attempt)
    assert r.status_code == 409


def test_attaching_the_matching_clip_queues_one_job(queued):
    _, _, attempt, job = queued
    assert job.status == QUEUED and job.model_version == attempt.model_version
    assert (
        attempt.verification_status == Verification.PENDING
        or Attempt.objects.get(pk=attempt.pk).verification_status == Verification.PENDING
    )


def test_attaching_twice_replays_instead_of_duplicating(queued):
    client, _, attempt, job = queued
    again = attach(client, attempt, job.audio_asset_id)
    assert again.status_code == 200 and again["Idempotent-Replay"] == "true"
    assert ScoringJob.objects.filter(attempt=attempt).count() == 1


def test_a_clip_with_other_bytes_is_refused(spot, storage):
    client, _ = spot
    attempt = requested_attempt(client)
    other = WEBM + b"x"
    _, asset_id = upload_clip(client, storage, attempt, data=other)
    r = attach(client, attempt, asset_id)
    assert r.status_code == 400
    assert not ScoringJob.objects.exists()


def test_a_clip_of_the_wrong_length_is_refused(spot, storage):
    client, _ = spot
    attempt = requested_attempt(client)
    _, asset_id = upload_clip(client, storage, attempt, duration_ms=9000)
    assert attach(client, attempt, asset_id).status_code == 400


def test_someone_elses_clip_cannot_be_attached(spot, storage, queued, auth_client):
    _, _, attempt, job = queued
    thief = auth_client()
    thief.get(f"{API}/me/")
    assert attach(thief, attempt, job.audio_asset_id).status_code in (403, 404)


# --- claim / heartbeat --------------------------------------------------------------------------------


def test_claim_requires_a_worker_signature(queued, client):
    r = signed_post(client, "/internal/scoring-jobs/claim/", {}, sign=False)
    assert r.status_code in (401, 403)
    r = signed_post(client, "/internal/scoring-jobs/claim/", {}, secret="wrong")
    assert r.status_code in (401, 403)


def test_an_idle_queue_returns_null(spot, client):
    assert claim(client=client).json() == {"job": None}


def test_claim_leases_the_job_and_leaks_no_identity(queued, client):
    _, profile, attempt, job = queued
    body = claim(client=client).json()["job"]
    assert body["id"] == str(job.pk)
    text = str(body)
    assert str(profile.pk) not in text and "@" not in text
    assert body["audio"]["url"] and body["model"]["sha256"] == job.model_version.sha256
    assert body["twister"]["focus"] and body["twister"]["words"]
    job.refresh_from_db()
    assert job.status == RUNNING and job.tries == 1 and job.locked_until > timezone.now()
    assert claim("w2", client=client).json() == {"job": None}  # nobody else can take it


def test_an_expired_lease_is_requeued_then_failed_after_max_tries(queued, client):
    _, _, attempt, job = queued
    for n in range(settings.SCORING_JOB_MAX_TRIES):
        assert claim(client=client).json()["job"] is not None, n
        ScoringJob.objects.filter(pk=job.pk).update(
            locked_until=timezone.now() - dt.timedelta(seconds=1)
        )
        jobs.sweep_leases()
    job, attempt = settled(job)
    assert job.status == FAILED and attempt.verification_status == Verification.FAILED


def test_heartbeat_extends_the_lease_and_reports_a_lost_one(queued, client):
    _, _, _, job = queued
    claim(client=client)
    first = ScoringJob.objects.get(pk=job.pk).locked_until
    r = signed_post(client, f"/internal/scoring-jobs/{job.pk}/heartbeat/", {})
    assert r.status_code == 200 and ScoringJob.objects.get(pk=job.pk).locked_until >= first
    ScoringJob.objects.filter(pk=job.pk).update(status=QUEUED)
    r = signed_post(client, f"/internal/scoring-jobs/{job.pk}/heartbeat/", {})
    assert r.status_code == 409 and error_code(r) == "lease_lost"


def test_consent_withdrawn_before_claim_expires_the_job_and_deletes_the_clip(
    queued, client, storage
):
    _, profile, attempt, job = queued
    UserConsent.objects.filter(profile=profile).update(revoked_at=timezone.now())
    assert claim(client=client).json() == {"job": None}
    job, attempt = settled(job)
    assert job.status == "expired"
    assert not MediaAsset.objects.filter(pk=job.audio_asset_id).exclude(status="deleted").exists()


# --- result ------------------------------------------------------------------------------------------


def run(queued, client, body):
    job = queued[3]
    claim(client=client)
    r = result(client, job, {"status": DONE, "words": GOOD_WORDS, **body})
    return r, *settled(job)


def test_agreement_verifies_the_attempt(queued, client):
    r, job, attempt = run(queued, client, {"score": queued[2].score - 4})
    assert r.status_code == 200
    assert attempt.verification_status == Verification.VERIFIED
    assert job.status == DONE and attempt.spot_check_delta == pytest.approx(4)


def test_inflation_flags_the_attempt(queued, client):
    _, job, attempt = run(queued, client, {"score": queued[2].score - 40})
    assert attempt.verification_status == Verification.FAILED and attempt.flagged


def test_deflation_is_verified_not_flagged(queued, client):
    attempt0 = queued[2]
    Attempt.objects.filter(pk=attempt0.pk).update(score=40)
    _, job, attempt = run(queued, client, {"score": 90})
    assert attempt.verification_status == Verification.VERIFIED and not attempt.flagged


def test_a_false_focus_credit_flags_even_when_scores_agree(queued, client):
    words = [{"i": 1, "status": "wrong", "reason": "focus_swap"}]
    job = queued[3]
    from twisters.models import AttemptWord

    AttemptWord.objects.filter(attempt=queued[2], target_index=1).update(
        status="correct", reason=""
    )
    claim(client=client)
    result(client, job, {"status": DONE, "score": queued[2].score, "words": words})
    _, attempt = settled(job)
    assert attempt.flagged and attempt.verification_status == Verification.FAILED


def test_an_unscorable_clip_leaves_the_device_result_standing(queued, client):
    _, job, attempt = run(queued, client, {"unscorable": "no_speech", "score": None})
    assert attempt.verification_status == Verification.FAILED and not attempt.flagged


def test_a_result_from_another_model_is_not_compared(queued, client):
    _, job, attempt = run(queued, client, {"score": 1, "model_sha256": "b" * 64})
    assert not attempt.flagged


def test_a_retryable_failure_requeues_and_a_final_one_fails(queued, client):
    job = queued[3]
    claim(client=client)
    result(client, job, {"status": FAILED, "error_code": "decode_error", "retryable": True})
    assert settled(job)[0].status == QUEUED
    ScoringJob.objects.filter(pk=job.pk).update(tries=settings.SCORING_JOB_MAX_TRIES - 1)
    claim(client=client)
    result(client, job, {"status": FAILED, "error_code": "decode_error", "retryable": False})
    job, attempt = settled(job)
    assert job.status == FAILED and not attempt.flagged


def test_the_callback_is_idempotent(queued, client):
    job = queued[3]
    claim(client=client)
    body = {"status": DONE, "score": queued[2].score, "words": GOOD_WORDS}
    assert result(client, job, body).status_code == 200
    again = result(client, job, {**body, "score": 0})
    assert again.status_code == 200
    assert settled(job)[1].verification_status == Verification.VERIFIED


@pytest.mark.parametrize(
    "body",
    [
        {"status": "weird"},
        {"status": DONE, "score": 140},
        {"status": DONE, "score": True},
        {"status": DONE, "score": float("nan")},
        {"status": DONE, "unscorable": "because"},
        {"status": DONE, "score": 90, "words": [{"i": 99, "status": "correct"}]},
        {"status": DONE, "score": 90, "words": [{"i": 0, "status": "meh"}]},
        {"status": DONE, "score": 90, "latency_ms": -4},
    ],
)
def test_result_bodies_are_validated(queued, client, body):
    job = queued[3]
    claim(client=client)
    assert result(client, job, body).status_code == 400
    assert settled(job)[0].status == RUNNING


def test_the_result_endpoint_needs_a_signature_and_hides_unknown_jobs(queued, client):
    job = queued[3]
    assert result(client, job, {"status": DONE}, sign=False).status_code in (401, 403)
    ghost = ScoringJob(pk=987654)
    assert result(client, ghost, {"status": DONE, "score": 1}).status_code == 404


def test_the_clip_is_deleted_once_the_check_settles(queued, client, storage):
    asset = queued[3].audio_asset
    assert storage.exists(asset.bucket, asset.path)
    run(queued, client, {"score": queued[2].score})
    assert not storage.exists(asset.bucket, asset.path)


# --- sweeper -----------------------------------------------------------------------------------------


def test_the_sweeper_closes_unanswered_requests(spot):
    attempt = requested_attempt(spot[0])
    stale = timezone.now() - dt.timedelta(minutes=settings.SPOT_CHECK_AUDIO_WINDOW_MIN + 1)
    Attempt.objects.filter(pk=attempt.pk).update(spot_check_requested_at=stale)
    jobs.sweep()
    attempt.refresh_from_db()
    assert attempt.verification_status == Verification.DEVICE  # the device result simply stands


def test_the_sweeper_expires_a_job_whose_model_was_retired(queued):
    _, _, attempt, job = queued
    AcousticModelVersion.objects.update(active=False)
    jobs.sweep()
    assert settled(job)[0].status == "expired"


def test_three_flagged_attempts_distrust_the_device(spot, storage, client):
    cl, profile = spot
    for n in range(3):
        data = WEBM + bytes([n])
        attempt = requested_attempt(cl, data=data)
        _, asset_id = upload_clip(cl, storage, attempt, data=data)
        assert attach(cl, attempt, asset_id).status_code == 202
        job = ScoringJob.objects.get(attempt=attempt)
        claim(client=client)
        result(client, job, {"status": DONE, "score": 10, "words": GOOD_WORDS})
    profile.refresh_from_db()
    assert ScoringProfile.objects.exists()
    from twisters.speak import trust

    assert trust.device_distrusted(profile)
