"""The media-worker queue: enqueue on complete, claim/heartbeat (HMAC), leases, sweeper, analysis."""

import datetime as dt
import json
import uuid

import pytest
from django.core.management import call_command
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from twisters.media import jobs, processing
from twisters.models import (
    ConsentType,
    FeatureFlag,
    MediaAsset,
    MediaJob,
    MediaStatus,
    Recording,
    RecordingStatus,
    UserConsent,
)

from .media_helpers import (
    API,
    MP4,
    WAV,
    WEBM,
    error_code,
    ledger_total,
    saved_recording,
    signed_post,
)
from .speak_helpers import submit


@pytest.fixture(autouse=True)
def _worker_on(settings):
    settings.WORKER_SHARED_SECRET = "worker-secret"
    settings.MEDIA_PROCESSING_ENABLED = True


@pytest.fixture
def queued(cloud_user, storage):
    """(client, profile, recording, job) for a take waiting in the queue."""
    client, profile = cloud_user
    rec = saved_recording(client, storage)
    assert rec["status"] == "processing"
    recording = Recording.objects.get(pk=rec["id"])
    return client, profile, recording, MediaJob.objects.get(recording=recording)


def claim(anon):
    return signed_post(anon, "/internal/media/claim/")


def later(seconds: float) -> dt.datetime:
    return timezone.now() + dt.timedelta(seconds=seconds)


# --- enqueue ------------------------------------------------------------------------------------


def test_complete_enqueues_one_process_job_for_the_uploaded_asset(queued):
    _, _, recording, job = queued
    assert (job.kind, job.status, job.tries, job.max_tries) == ("process", "queued", 0, 3)
    assert job.asset_id == recording.video_asset_id and job.locked_until is None


def test_without_a_worker_complete_enqueues_nothing(cloud_user, storage, settings):
    settings.MEDIA_PROCESSING_ENABLED = False
    saved_recording(cloud_user[0], storage)
    assert MediaJob.objects.count() == 0


def test_enqueue_is_idempotent_and_the_database_enforces_it(queued):
    _, _, recording, job = queued
    same, created = jobs.enqueue(recording, "process", recording.video_asset)
    assert same.pk == job.pk and created is False
    with pytest.raises(IntegrityError), transaction.atomic():
        MediaJob.objects.create(recording=recording, asset=recording.video_asset, kind="process")
    MediaJob.objects.filter(pk=job.pk).update(status="failed")
    again, created = jobs.enqueue(recording, "process", recording.video_asset)
    assert created and again.pk != job.pk  # a finished job does not block a new one


@pytest.mark.parametrize(
    "fields",
    [
        {"status": "running"},  # running without a lease
        {"kind": "other"},  # short enough to reach the CHECK (Postgres fails length first)
        {"status": "weird"},
        {"tries": 4},  # above max_tries
        {"max_tries": 0},
    ],
)
def test_job_table_constraints_reject_bad_rows(queued, fields):
    _, _, recording, job = queued
    MediaJob.objects.filter(pk=job.pk).update(status="done")
    with pytest.raises(IntegrityError), transaction.atomic():
        MediaJob.objects.create(
            recording=recording, asset=recording.video_asset, **{"kind": "analyse", **fields}
        )


def test_state_machine_only_allows_documented_edges(queued):
    _, _, _, job = queued
    job.transition("running", locked_until=later(60))
    job.transition("done")
    from twisters.models import InvalidTransition

    with pytest.raises(InvalidTransition):
        job.transition("queued")


# --- claim --------------------------------------------------------------------------------------


def test_claim_needs_a_valid_signature(queued, anon, settings):
    assert signed_post(anon, "/internal/media/claim/", sign=False).status_code == 403
    assert signed_post(anon, "/internal/media/claim/", secret="nope").status_code == 403
    settings.WORKER_SHARED_SECRET = ""
    assert claim(anon).status_code == 503
    assert MediaJob.objects.get().status == "queued"


def test_an_idle_queue_answers_null(anon, db):
    r = claim(anon)
    assert r.status_code == 200 and r.data == {"job": None}


def test_claim_returns_the_documented_payload_and_takes_a_lease(queued, anon, settings):
    _, profile, recording, job = queued
    r = claim(anon)
    assert r.status_code == 200
    body = r.data["job"]
    assert set(body) == {
        "id", "kind", "recording_id", "asset_id", "lease_s",
        "source", "outputs", "words", "limits",
    }  # fmt: skip
    assert body["id"] == job.pk and body["kind"] == "process" and body["lease_s"] == 120
    assert body["recording_id"] == recording.pk and body["asset_id"] == recording.video_asset_id
    assert body["source"]["mime"] == "video/webm" and body["source"]["size_bytes"] == len(WEBM)
    assert body["source"]["url"].startswith("memory://recordings/")
    assert set(body["outputs"]) == {"mp4", "thumbnail", "captions"}
    for name, mime in (("mp4", "video/mp4"), ("thumbnail", "image/jpeg"), ("captions", "text/vtt")):
        out = body["outputs"][name]
        assert set(out) == {"bucket", "path", "upload_url", "token", "mime"}
        assert out["mime"] == mime and out["token"] in out["upload_url"]
        assert out["path"].startswith(processing.uploads.owner_folder(profile.pk) + "/")
        assert str(profile.pk) not in out["path"]
    assert body["words"] is None and body["limits"] == {"max_height": 1080, "max_s": 900}
    job.refresh_from_db()
    assert job.status == "running" and job.tries == 1 and job.locked_until > timezone.now()
    assert claim(anon).data == {"job": None}  # nothing else to take


def test_output_paths_are_deterministic_per_job(queued, anon):
    _, _, _, job = queued
    first = claim(anon).data["job"]["outputs"]["mp4"]["path"]
    assert first == processing.output_path(job, "mp4")
    assert str(processing.output_asset_id(job, "mp4")) in first


def test_process_jobs_carry_the_attempt_word_timings(cloud_user, storage, anon):
    client, _ = cloud_user
    attempt = submit(client).data
    saved_recording(client, storage, attempt=attempt["id"])
    words = claim(anon).data["job"]["words"]
    assert words and set(words[0]) == {"target", "start_ms", "end_ms", "status"}
    assert [w["target"] for w in words][:2] == ["she", "sells"]


def test_the_oldest_job_goes_first(cloud_user, storage, anon):
    client, _ = cloud_user
    first = saved_recording(client, storage)
    saved_recording(client, storage)
    assert claim(anon).data["job"]["recording_id"] == uuid.UUID(first["id"])


def test_a_claim_hands_the_job_back_when_signing_fails(queued, anon, storage):
    _, _, _, job = queued
    storage.fail_next = "signed_url"
    r = claim(anon)
    assert r.status_code == 503
    job.refresh_from_db()
    assert job.status == "queued" and job.tries == 0 and job.locked_until is None


def test_soft_deleted_recordings_are_not_handed_out(queued, anon):
    client, _, recording, _ = queued
    client.delete(f"{API}/recordings/{recording.pk}/")
    assert claim(anon).data == {"job": None}
    client.post(f"{API}/recordings/{recording.pk}/restore/")
    assert claim(anon).data["job"]["recording_id"] == recording.pk


def test_losing_a_claim_race_moves_on(queued, monkeypatch):
    """Both workers read the same queued row; only the conditional UPDATE's winner gets it."""
    _, _, _, job = queued
    real = jobs._candidates

    class Stale:
        def __init__(self):
            self.qs = real()

        def select_for_update(self, **_):
            return self

        def first(self):
            row = self.qs.first()
            if row is not None:  # the other worker wins between our read and our update
                MediaJob.objects.filter(pk=row.pk).update(status="running", locked_until=later(60))
            return row

    monkeypatch.setattr(jobs, "_candidates", Stale)
    assert jobs.claim() is None
    assert MediaJob.objects.get(pk=job.pk).tries == 0  # we never counted a try for the loser


@pytest.mark.skipif(
    not connection.features.has_select_for_update_skip_locked, reason="needs PostgreSQL"
)
def test_postgres_claims_with_skip_locked(queued):
    with CaptureQueriesContext(connection) as ctx:
        assert jobs.claim() is not None
    assert any("SKIP LOCKED" in q["sql"] for q in ctx.captured_queries)


@pytest.mark.skipif(
    connection.features.has_select_for_update_skip_locked, reason="sqlite fallback path"
)
def test_the_sqlite_fallback_does_not_use_skip_locked(queued):
    with CaptureQueriesContext(connection) as ctx:
        assert jobs.claim() is not None
    assert not any("SKIP LOCKED" in q["sql"] for q in ctx.captured_queries)


# --- heartbeat & leases -------------------------------------------------------------------------


def beat(anon, job_id, **kw):
    return signed_post(anon, f"/internal/media/jobs/{job_id}/heartbeat/", **kw)


def test_heartbeat_extends_the_lease(queued, anon):
    _, _, _, job = queued
    claim(anon)
    MediaJob.objects.filter(pk=job.pk).update(locked_until=later(5))
    r = beat(anon, job.pk)
    assert r.status_code == 200 and r.data["job_id"] == job.pk and r.data["lease_s"] == 120
    job.refresh_from_db()
    assert job.locked_until > later(100)


def test_heartbeat_is_signed_and_reports_a_lost_lease(queued, anon):
    _, _, _, job = queued
    assert beat(anon, job.pk, sign=False).status_code == 403
    assert error_code(beat(anon, job.pk)) == "lease_lost"  # still queued: nothing to extend
    assert beat(anon, uuid.uuid4()).status_code == 404
    claim(anon)
    assert beat(anon, job.pk).status_code == 200
    MediaJob.objects.filter(pk=job.pk).update(status="done")
    assert error_code(beat(anon, job.pk)) == "lease_lost"


def test_a_lapsed_lease_is_requeued_then_failed_after_max_tries(queued):
    _, _, recording, job = queued
    for attempt in (1, 2):
        assert jobs.claim() is not None
        swept = jobs.sweep(later(1000))
        assert (swept.requeued, swept.failed) == (1, 0)
        assert MediaJob.objects.get(pk=job.pk).status == "queued"
        assert MediaJob.objects.get(pk=job.pk).tries == attempt
    assert jobs.claim() is not None  # third and last try
    swept = jobs.sweep(later(1000))
    assert (swept.requeued, swept.failed) == (0, 1)
    job.refresh_from_db()
    recording.refresh_from_db()
    assert job.status == "failed" and job.error_code == "lease_expired"
    assert recording.status == RecordingStatus.FAILED
    assert recording.failure_reason == "lease_expired"
    assert recording.video_asset.status == MediaStatus.FAILED


def test_claim_recovers_a_crashed_workers_job_without_the_sweeper(queued):
    _, _, _, job = queued
    assert jobs.claim() is not None
    MediaJob.objects.filter(pk=job.pk).update(locked_until=timezone.now() - dt.timedelta(seconds=1))
    again = jobs.claim()
    assert again is not None and again.pk == job.pk and again.tries == 2


def test_a_heartbeating_job_survives_the_sweeper(queued):
    _, _, _, job = queued
    jobs.claim()
    jobs.heartbeat(job.pk, later(900))
    assert jobs.sweep(later(950)).requeued == 0
    assert MediaJob.objects.get(pk=job.pk).status == "running"


def test_the_sweeper_command_reports_job_housekeeping(queued, capsys):
    _, _, _, job = queued
    jobs.claim()
    MediaJob.objects.filter(pk=job.pk).update(locked_until=timezone.now() - dt.timedelta(seconds=5))
    call_command("orphan_sweeper")
    out = capsys.readouterr().out
    assert "requeued=1" in out and MediaJob.objects.get(pk=job.pk).status == "queued"


def test_jobs_of_hard_deleted_recordings_are_cancelled(queued):
    _, _, recording, job = queued
    Recording.objects.filter(pk=recording.pk).update(status="deleted", deleted_at=timezone.now())
    assert jobs.sweep().cancelled == 1
    assert MediaJob.objects.get(pk=job.pk).error_code == "source_gone"


def test_a_leftover_original_is_removed_by_the_sweeper_even_if_storage_hiccuped(
    queued, anon, storage
):
    from .media_helpers import signed_post as post

    client, profile, recording, job = queued
    original = recording.video_asset
    claim(anon)
    storage.simulate_upload("recordings", processing.output_path(job, "mp4"), MP4 + bytes(20))
    storage.fail_next = None
    storage_delete = storage.delete

    def flaky(bucket, path):
        if path == original.path:
            storage.delete = storage_delete
            raise processing.uploads.StorageError("boom")
        return storage_delete(bucket, path)

    storage.delete = flaky
    r = post(
        anon,
        f"/internal/media/{original.pk}/processed/",
        {"status": "ready", "job_id": str(job.pk), "outputs": ["mp4"]},
    )
    assert r.status_code == 200
    original.refresh_from_db()
    assert original.status != MediaStatus.DELETED and ledger_total(profile) > len(MP4)
    call_command("orphan_sweeper")
    original.refresh_from_db()
    assert original.status == MediaStatus.DELETED
    assert ledger_total(profile) == len(MP4) + 20


def test_processed_with_a_job_id_for_another_asset_is_a_404(queued, anon, cloud_user, storage):
    client, _ = cloud_user
    other = saved_recording(client, storage)
    other_asset = Recording.objects.get(pk=other["id"]).video_asset_id
    job = queued[3]
    r = signed_post(
        anon,
        f"/internal/media/{other_asset}/processed/",
        {"status": "ready", "job_id": str(job.pk)},
    )
    assert r.status_code == 404


# --- analyse ------------------------------------------------------------------------------------


def analyse(client, rec_id):
    return client.post(f"{API}/recordings/{rec_id}/analyse/")


@pytest.fixture
def analysable(cloud_user, storage, settings):
    """A ready take (processed without a worker) whose owner consented to voice processing."""
    settings.MEDIA_PROCESSING_ENABLED = False
    client, profile = cloud_user
    UserConsent.objects.create(profile=profile, type=ConsentType.VOICE_PROCESSING, version="v1")
    rec = saved_recording(client, storage)
    settings.MEDIA_PROCESSING_ENABLED = True
    return client, profile, Recording.objects.get(pk=rec["id"])


def test_detail_analysis_is_none_until_one_is_requested(analysable):
    client, _, rec = analysable
    assert client.get(f"{API}/recordings/{rec.pk}/").data["analysis"] == {
        "status": "none",
        "audio_ready": False,
    }


def test_analyse_queues_a_job_and_is_idempotent(analysable):
    client, _, rec = analysable
    first = analyse(client, rec.pk)
    assert first.status_code == 202
    assert first.data == {"analysis": {"status": "queued", "audio_ready": False}}
    second = analyse(client, rec.pk)
    assert second.status_code == 200 and second.headers["Idempotent-Replay"] == "true"
    assert MediaJob.objects.filter(recording=rec, kind="analyse").count() == 1
    assert client.get(f"{API}/recordings/{rec.pk}/").data["analysis"] == first.data["analysis"]


def test_analyse_gates(user, storage, settings, analysable):
    client, profile, rec = analysable
    settings.MEDIA_PROCESSING_ENABLED = False
    assert error_code(analyse(client, rec.pk)) == "feature_disabled"
    settings.MEDIA_PROCESSING_ENABLED = True
    UserConsent.objects.filter(profile=profile, type="voice_processing").update(
        revoked_at=timezone.now()
    )
    assert error_code(analyse(client, rec.pk)) == "consent_required"
    UserConsent.objects.create(profile=profile, type="voice_processing", version="v1")
    type(profile).objects.filter(pk=profile.pk).update(age_band="under13")
    assert error_code(analyse(client, rec.pk)) == "minor_not_allowed"
    type(profile).objects.filter(pk=profile.pk).update(age_band="unknown")
    assert error_code(analyse(client, rec.pk)) == "age_required"
    type(profile).objects.filter(pk=profile.pk).update(age_band="13plus")
    FeatureFlag.objects.filter(code="record_cloud").update(enabled=False)
    assert error_code(analyse(client, rec.pk)) == "feature_disabled"


def test_analyse_needs_a_usable_recording(analysable):
    client, _, rec = analysable
    Recording.objects.filter(pk=rec.pk).update(status="failed")
    assert analyse(client, rec.pk).status_code == 409


def test_another_users_analyse_is_a_404(analysable, auth_client):
    _, _, rec = analysable
    other = auth_client()
    other.get(f"{API}/me/")
    assert analyse(other, rec.pk).status_code == 404


def test_the_worker_extracts_audio_and_the_take_becomes_analysable(analysable, anon, storage):
    client, profile, rec = analysable
    analyse(client, rec.pk)
    job = claim(anon).data["job"]
    assert job["kind"] == "analyse" and set(job["outputs"]) == {"audio"}
    assert job["outputs"]["audio"]["mime"] == "audio/wav" and job["words"] is None
    db_job = MediaJob.objects.get(pk=job["id"])
    assert client.get(f"{API}/recordings/{rec.pk}/").data["analysis"]["status"] == "running"

    big_wav = WAV + bytes(3 * 1024 * 1024)  # bigger than the 2 MB voice-clip cap: server-made file
    storage.simulate_upload("voice", processing.output_path(db_job, "audio"), big_wav)
    done = signed_post(
        anon,
        f"/internal/media/{job['asset_id']}/processed/",
        {"status": "ready", "job_id": job["id"].__str__(), "outputs": ["audio"]},
    )
    assert done.status_code == 200 and done.data["job_status"] == "done"
    detail = client.get(f"{API}/recordings/{rec.pk}/").data
    assert detail["analysis"] == {"status": "ready", "audio_ready": True}
    rec.refresh_from_db()
    assert rec.status == RecordingStatus.READY and rec.audio_asset.kind == "audio"
    assert rec.audio_asset.expires_at > timezone.now() + dt.timedelta(days=6)
    assert ledger_total(profile) == len(WEBM) + len(big_wav)
    again = analyse(client, rec.pk)
    assert again.status_code == 200 and again.data["analysis"]["audio_ready"] is True
    assert MediaJob.objects.filter(recording=rec, kind="analyse").count() == 1


def test_analysis_waits_for_processing_to_settle_and_follows_the_new_source(
    cloud_user, storage, anon, settings
):
    client, profile = cloud_user
    UserConsent.objects.create(profile=profile, type=ConsentType.VOICE_PROCESSING, version="v1")
    rec = saved_recording(client, storage)  # processing, process job queued
    assert analyse(client, rec["id"]).status_code == 202
    process = claim(anon).data["job"]
    assert process["kind"] == "process"  # the analyse job is not offered while processing
    assert claim(anon).data == {"job": None}
    storage.simulate_upload(
        "recordings", processing.output_path(MediaJob.objects.get(pk=process["id"]), "mp4"), MP4
    )
    signed_post(
        anon,
        f"/internal/media/{process['asset_id']}/processed/",
        {"status": "ready", "job_id": process["id"].__str__(), "outputs": ["mp4"]},
    )
    job = claim(anon).data["job"]
    new_video = Recording.objects.get(pk=rec["id"]).video_asset_id
    assert job["kind"] == "analyse" and job["asset_id"] == new_video
    assert job["source"]["mime"] == "video/mp4"


def test_a_failed_analysis_reports_failed_and_can_be_requested_again(analysable, anon):
    client, _, rec = analysable
    analyse(client, rec.pk)
    job = claim(anon).data["job"]
    r = signed_post(
        anon,
        f"/internal/media/{job['asset_id']}/processed/",
        {"status": "failed", "job_id": str(job["id"]), "error": "no_audio", "retryable": False},
    )
    assert r.data["job_status"] == "failed"
    assert client.get(f"{API}/recordings/{rec.pk}/").data["analysis"] == {
        "status": "failed",
        "audio_ready": False,
    }
    assert Recording.objects.get(pk=rec.pk).status == RecordingStatus.READY  # take unaffected
    assert analyse(client, rec.pk).status_code == 202


def test_analysis_audio_follows_the_recording_to_the_grave_and_consent_withdrawal(
    analysable, anon, storage
):
    client, profile, rec = analysable
    analyse(client, rec.pk)
    job = claim(anon).data["job"]
    path = processing.output_path(MediaJob.objects.get(pk=job["id"]), "audio")
    storage.simulate_upload("voice", path, WAV)
    signed_post(
        anon,
        f"/internal/media/{job['asset_id']}/processed/",
        {"status": "ready", "job_id": str(job["id"]), "outputs": ["audio"]},
    )
    hours = timezone.now() - dt.timedelta(hours=30)
    UserConsent.objects.filter(profile=profile, type="voice_processing").update(
        granted_at=hours - dt.timedelta(hours=2), revoked_at=hours
    )
    MediaAsset.objects.filter(profile=profile).update(created_at=hours - dt.timedelta(hours=1))
    call_command("expire_recordings")
    assert not storage.exists("voice", path)
    assert ledger_total(profile) == len(WEBM)
    assert client.get(f"{API}/recordings/{rec.pk}/").data["analysis"] == {
        "status": "none",
        "audio_ready": False,
    }


def test_hard_delete_removes_the_analysis_audio(analysable, anon, storage):
    client, profile, rec = analysable
    analyse(client, rec.pk)
    job = claim(anon).data["job"]
    path = processing.output_path(MediaJob.objects.get(pk=job["id"]), "audio")
    storage.simulate_upload("voice", path, WAV)
    signed_post(
        anon,
        f"/internal/media/{job['asset_id']}/processed/",
        {"status": "ready", "job_id": str(job["id"]), "outputs": ["audio"]},
    )
    client.delete(f"{API}/recordings/{rec.pk}/")
    Recording.objects.filter(pk=rec.pk).update(deleted_at=timezone.now() - dt.timedelta(hours=30))
    call_command("expire_recordings")
    assert not storage.objects and ledger_total(profile) == 0


def test_bad_processed_bodies_are_400(queued, anon):
    asset = queued[2].video_asset_id
    path = f"/internal/media/{asset}/processed/"
    for body in (
        {"status": "ready", "outputs": "mp4"},
        {"status": "ready", "outputs": [1]},
        {"status": "ready", "job_id": "nope"},
        [],
    ):
        raw = json.dumps(body).encode()
        assert signed_post(anon, path, raw=raw).status_code == 400
