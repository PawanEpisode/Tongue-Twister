"""Worker callback (HMAC) and the scheduled jobs: retention, hard delete, consent revocation, sweeper."""

import datetime as dt
import hashlib
import hmac
import json
import uuid

import pytest
from django.core.management import call_command
from django.utils import timezone

from twisters.media import recordings
from twisters.media.processing import output_path
from twisters.models import (
    Attempt,
    ConsentType,
    MediaAsset,
    MediaJob,
    MediaStatus,
    Plan,
    Recording,
    RecordingStatus,
    ShareLink,
    StorageLedger,
    UserConsent,
)

from .media_helpers import (
    API,
    JPEG,
    MP4,
    WEBM,
    create_recording,
    error_code,
    ledger_total,
    put_upload,
    saved_recording,
)
from .speak_helpers import submit
from .test_media_shares import share
from .test_media_voice import create_voice, ready_voice

SECRET = "worker-secret"


def claimed_tries(job: MediaJob, tries: int) -> None:
    """Put the job in the state a worker's claim would (running, `tries` used)."""
    MediaJob.objects.filter(pk=job.pk).update(
        status="running", tries=tries, locked_until=timezone.now() + dt.timedelta(minutes=5)
    )


def hours_ago(n: float) -> dt.datetime:
    return timezone.now() - dt.timedelta(hours=n)


# --- worker callback ----------------------------------------------------------------------------


@pytest.fixture
def worker(settings, anon):
    settings.WORKER_SHARED_SECRET = SECRET
    settings.MEDIA_PROCESSING_ENABLED = True

    def post(asset_id, body, *, secret=SECRET, sign=True, raw=None):
        payload = raw if raw is not None else json.dumps(body).encode()
        headers = {}
        if sign:
            digest = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
            headers["HTTP_X_WORKER_SIGNATURE"] = f"sha256={digest}"
        return anon.post(
            f"{API}/internal/media/{asset_id}/processed/",
            payload,
            content_type="application/json",
            **headers,
        )

    return post


@pytest.fixture
def processing(cloud_user, storage, settings):
    settings.MEDIA_PROCESSING_ENABLED = True
    client, profile = cloud_user
    rec = saved_recording(client, storage)
    assert rec["status"] == "processing"
    return client, profile, Recording.objects.get(pk=rec["id"])


def test_callback_refuses_without_a_secret_or_valid_signature(processing, worker, settings):
    _, _, rec = processing
    body = {"status": "ready"}
    assert worker(rec.video_asset_id, body, sign=False).status_code == 403
    assert worker(rec.video_asset_id, body, secret="wrong").status_code == 403
    settings.WORKER_SHARED_SECRET = ""
    assert worker(rec.video_asset_id, body).status_code == 503
    assert Recording.objects.get(pk=rec.pk).status == RecordingStatus.PROCESSING


def test_ready_callback_updates_the_recording_and_is_idempotent(processing, worker):
    client, _, rec = processing
    body = {"status": "ready", "duration_ms": 40_000, "width": 1280, "height": 720}
    first = worker(rec.video_asset_id, body)
    assert first.status_code == 200
    assert first.data == {"status": "ready", "job_status": "done"}
    rec.refresh_from_db()
    assert rec.status == RecordingStatus.READY and rec.duration_ms == 40_000 and rec.width == 1280
    assert rec.video_asset.status == MediaStatus.READY
    again = worker(rec.video_asset_id, body)
    assert again.status_code == 200 and again.headers["Idempotent-Replay"] == "true"
    assert client.get(f"{API}/recordings/{rec.pk}/").data["playback"]["url"]


def test_callback_adopts_derived_files_at_the_paths_the_api_chose(processing, worker, storage):
    _, profile, rec = processing
    job = MediaJob.objects.get(recording=rec)
    thumb, captions = output_path(job, "thumbnail"), output_path(job, "captions")
    storage.simulate_upload("thumbs", thumb, JPEG)
    storage.simulate_upload("captions", captions, b"WEBVTT\n\n")
    r = worker(
        rec.video_asset_id,
        {"status": "ready", "job_id": str(job.pk), "outputs": ["thumbnail", "captions"]},
    )
    assert r.status_code == 200
    rec.refresh_from_db()
    assert rec.thumbnail_asset.path == thumb and rec.captions_asset.path == captions
    assert rec.captions_source == "alignment"
    assert ledger_total(profile) == len(WEBM) + len(JPEG) + len(b"WEBVTT\n\n")


def test_callback_never_trusts_a_path_from_the_worker(processing, worker, storage):
    _, profile, rec = processing
    job = MediaJob.objects.get(recording=rec)
    other = f"{uuid.uuid4()}/x.jpg"
    storage.simulate_upload("thumbs", other, JPEG)
    r = worker(
        rec.video_asset_id, {"status": "ready", "thumbnail_path": other, "captions_path": other}
    )
    assert r.status_code == 200
    rec.refresh_from_db()
    assert rec.thumbnail_asset_id is None and rec.captions_asset_id is None
    assert MediaJob.objects.get(pk=job.pk).status == "done"


def test_callback_needs_declared_outputs_to_exist_and_be_what_they_claim(
    processing, worker, storage
):
    _, _, rec = processing
    job = MediaJob.objects.get(recording=rec)
    missing = worker(
        rec.video_asset_id, {"status": "ready", "job_id": str(job.pk), "outputs": ["thumbnail"]}
    )
    assert missing.status_code == 409 and error_code(missing) == "upload_incomplete"
    assert MediaJob.objects.get(pk=job.pk).status == "queued"
    path = output_path(job, "thumbnail")
    storage.simulate_upload("thumbs", path, b"not a jpeg at all")
    bad = worker(
        rec.video_asset_id, {"status": "ready", "job_id": str(job.pk), "outputs": ["thumbnail"]}
    )
    assert bad.status_code == 422 and bad.data["error"]["details"]["reason"] == "not_media"
    assert not storage.exists("thumbs", path)  # the rejected object is removed
    assert MediaJob.objects.get(pk=job.pk).status == "queued"  # retried, tries left
    assert Recording.objects.get(pk=rec.pk).thumbnail_asset_id is None


def test_callback_rejects_outputs_the_job_kind_cannot_produce(processing, worker):
    _, _, rec = processing
    r = worker(rec.video_asset_id, {"status": "ready", "outputs": ["audio"]})
    assert r.status_code == 400


def test_transcode_replaces_the_original_and_its_bytes(processing, worker, storage):
    client, profile, rec = processing
    job = MediaJob.objects.get(recording=rec)
    original = rec.video_asset
    mp4 = MP4 + bytes(20)
    storage.simulate_upload("recordings", output_path(job, "mp4"), mp4)
    r = worker(
        original.pk,
        {"status": "ready", "job_id": str(job.pk), "outputs": ["mp4"], "duration_ms": 41_000},
    )
    assert r.status_code == 200
    rec.refresh_from_db()
    assert rec.video_asset_id != original.pk and rec.mime_type == "video/mp4"
    assert rec.size_bytes == len(mp4) and rec.status == RecordingStatus.READY
    original.refresh_from_db()
    assert original.status == MediaStatus.DELETED
    assert not storage.exists("recordings", original.path)
    assert ledger_total(profile) == len(mp4)  # the transcode replaced the original in the quota
    detail = client.get(f"{API}/recordings/{rec.pk}/").data
    assert detail["playback"]["mime"] == "video/mp4"
    again = worker(original.pk, {"status": "ready", "job_id": str(job.pk), "outputs": ["mp4"]})
    assert again.headers["Idempotent-Replay"] == "true" and ledger_total(profile) == len(mp4)


def test_a_transcode_that_does_not_fit_the_quota_is_dropped(processing, worker, storage):
    _, profile, rec = processing
    job = MediaJob.objects.get(recording=rec)
    Plan.objects.filter(code="free").update(limits={"storage_bytes_max": 200})
    storage.simulate_upload("thumbs", output_path(job, "thumbnail"), JPEG)
    storage.simulate_upload("recordings", output_path(job, "mp4"), MP4 + bytes(70))  # 88 bytes
    body = {"status": "ready", "job_id": str(job.pk), "outputs": ["thumbnail", "mp4"]}
    assert worker(rec.video_asset_id, body).status_code == 200
    rec.refresh_from_db()
    assert rec.status == RecordingStatus.READY and rec.mime_type.startswith("video/webm")
    assert rec.thumbnail_asset_id and not storage.exists("recordings", output_path(job, "mp4"))
    assert ledger_total(profile) == len(WEBM) + len(JPEG)


def test_failed_callback_requeues_then_fails_for_good_and_retry_processing_works(
    processing, worker
):
    client, _, rec = processing
    job = MediaJob.objects.get(recording=rec)
    claimed_tries(job, 1)
    r = worker(rec.video_asset_id, {"status": "failed", "error": "ffmpeg_crashed"})
    assert r.status_code == 200 and r.data["job_status"] == "queued"
    assert Recording.objects.get(pk=rec.pk).status == RecordingStatus.PROCESSING
    claimed_tries(job, 3)
    r = worker(rec.video_asset_id, {"status": "failed", "error": "ffmpeg_crashed"})
    assert r.data["job_status"] == "failed"
    rec.refresh_from_db()
    assert rec.status == RecordingStatus.FAILED and rec.failure_reason == "ffmpeg_crashed"
    retry = client.post(f"{API}/recordings/{rec.pk}/retry-processing/")
    assert retry.status_code == 202 and retry.data["status"] == "processing"
    assert retry.data["failure_reason"] == ""
    assert MediaJob.objects.filter(recording=rec, status="queued").count() == 1  # a fresh job


def test_a_non_retryable_failure_fails_immediately_and_repeats_are_replays(processing, worker):
    _, _, rec = processing
    claimed_tries(MediaJob.objects.get(recording=rec), 1)
    body = {"status": "failed", "error": "corrupt_input", "retryable": False}
    assert worker(rec.video_asset_id, body).data["job_status"] == "failed"
    again = worker(rec.video_asset_id, body)
    assert again.headers["Idempotent-Replay"] == "true"
    late = worker(rec.video_asset_id, {"status": "ready"})
    assert late.status_code == 409 and error_code(late) == "job_closed"


def test_retry_without_a_worker_makes_the_stored_upload_playable(processing, worker, settings):
    client, _, rec = processing
    claimed_tries(MediaJob.objects.get(recording=rec), 1)
    worker(rec.video_asset_id, {"status": "failed", "retryable": False})
    settings.MEDIA_PROCESSING_ENABLED = False
    retry = client.post(f"{API}/recordings/{rec.pk}/retry-processing/")
    assert retry.status_code == 202 and retry.data["status"] == "ready"


@pytest.mark.parametrize("body", [{"status": "weird"}, {}, {"status": None}])
def test_callback_validates_the_body(processing, worker, body):
    assert worker(processing[2].video_asset_id, body).status_code == 400


def test_callback_rejects_bad_json_and_unknown_assets(processing, worker):
    assert worker(processing[2].video_asset_id, None, raw=b"{nope").status_code == 400
    assert worker(uuid.uuid4(), {"status": "ready"}).status_code == 404


# --- expire_recordings --------------------------------------------------------------------------


def test_expiry_soft_deletes_then_hard_deletes_and_frees_everything(
    cloud_user, storage, anon, monkeypatch
):
    client, profile = cloud_user
    keep = saved_recording(client, storage)
    gone = saved_recording(client, storage)
    link = share(client, gone["id"])
    Recording.objects.filter(pk=gone["id"]).update(expires_at=hours_ago(30))
    path = Recording.objects.get(pk=gone["id"]).video_asset.path

    call_command("expire_recordings")
    victim = Recording.objects.get(pk=gone["id"])
    assert victim.deleted_at is not None and victim.status == RecordingStatus.READY
    assert ShareLink.objects.get(pk=link.data["id"]).revoked_at is not None
    assert storage.exists("recordings", path)  # still restorable
    assert Recording.objects.get(pk=keep["id"]).deleted_at is None

    Recording.objects.filter(pk=gone["id"]).update(deleted_at=hours_ago(25))
    call_command("expire_recordings")
    victim.refresh_from_db()
    assert victim.status == RecordingStatus.DELETED and victim.title == ""
    assert victim.video_asset.status == MediaStatus.DELETED and not storage.exists(
        "recordings", path
    )
    assert ledger_total(profile) == len(WEBM)  # only the kept recording remains charged
    assert StorageLedger.objects.filter(reason="expire").count() == 1

    call_command("expire_recordings")  # idempotent
    assert ledger_total(profile) == len(WEBM)


def test_hard_delete_waits_for_storage_and_retries(cloud_user, storage):
    client, profile = cloud_user
    rec = saved_recording(client, storage)
    client.delete(f"{API}/recordings/{rec['id']}/")
    Recording.objects.filter(pk=rec["id"]).update(deleted_at=hours_ago(25))
    storage.fail_next = "delete"
    assert recordings.hard_delete_due() == 0
    assert ledger_total(profile) == len(WEBM)
    assert Recording.objects.get(pk=rec["id"]).status != RecordingStatus.DELETED
    assert recordings.hard_delete_due() == 1 and ledger_total(profile) == 0


def test_a_recent_soft_delete_is_left_alone(cloud_user, storage):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    client.delete(f"{API}/recordings/{rec['id']}/")
    assert recordings.hard_delete_due() == 0


def test_hard_delete_removes_thumbnails_and_unlinks_voice_from_attempts(cloud_user, storage):
    client, profile = cloud_user
    voice = ready_voice(client, storage)
    attempt = submit(client, voice_asset_id=voice).data["id"]
    MediaAsset.objects.filter(pk=voice).update(expires_at=hours_ago(1))
    call_command("expire_recordings")
    assert Attempt.objects.get(pk=attempt).voice_asset_id is None
    assert MediaAsset.objects.get(pk=voice).status == MediaStatus.DELETED
    assert ledger_total(profile) == 0


# --- consent revocation -------------------------------------------------------------------------


def revoke(profile, type, hours):
    """Revoke `hours` ago, with everything that depended on the consent made older than that."""
    UserConsent.objects.filter(profile=profile, type=type).update(
        granted_at=hours_ago(hours + 2), revoked_at=hours_ago(hours)
    )
    Recording.objects.filter(profile=profile).update(consented_at=hours_ago(hours + 1))
    MediaAsset.objects.filter(profile=profile).update(created_at=hours_ago(hours + 1))


def test_revoked_recording_consent_removes_media_after_the_grace_period(cloud_user, storage):
    client, profile = cloud_user
    rec = saved_recording(client, storage)
    revoke(profile, ConsentType.RECORDING_UPLOAD, 1)
    call_command("expire_recordings")
    assert Recording.objects.get(pk=rec["id"]).deleted_at is None  # still inside 24 h
    revoke(profile, ConsentType.RECORDING_UPLOAD, 25)
    call_command("expire_recordings")
    assert Recording.objects.get(pk=rec["id"]).deleted_at is not None


def test_regranting_consent_keeps_the_media(cloud_user, storage):
    client, profile = cloud_user
    rec = saved_recording(client, storage)
    revoke(profile, ConsentType.RECORDING_UPLOAD, 30)
    UserConsent.objects.create(profile=profile, type=ConsentType.RECORDING_UPLOAD, version="v1")
    call_command("expire_recordings")
    assert Recording.objects.get(pk=rec["id"]).deleted_at is None


def test_revoked_voice_consent_purges_clips(cloud_user, storage):
    client, profile = cloud_user
    voice = ready_voice(client, storage)
    revoke(profile, ConsentType.VOICE_STORAGE, 25)
    call_command("expire_recordings")
    assert MediaAsset.objects.get(pk=voice).status == MediaStatus.DELETED
    assert ledger_total(profile) == 0


def test_recordings_made_after_a_regrant_survive_an_older_revocation(cloud_user, storage):
    client, profile = cloud_user
    revoke(profile, ConsentType.RECORDING_UPLOAD, 30)
    UserConsent.objects.filter(profile=profile, type="recording_upload").update(
        revoked_at=hours_ago(30)
    )
    UserConsent.objects.create(profile=profile, type=ConsentType.RECORDING_UPLOAD, version="v1")
    rec = saved_recording(client, storage)
    call_command("expire_recordings")
    assert Recording.objects.get(pk=rec["id"]).deleted_at is None


# --- orphan sweeper -----------------------------------------------------------------------------


def test_orphan_sweeper_frees_abandoned_uploads_only(cloud_user, storage, settings):
    client, profile = cloud_user
    stale = create_recording(client, size_bytes=5000)
    fresh = create_recording(client, size_bytes=7000)
    done = saved_recording(client, storage)
    voice = create_voice(client)
    put_upload(storage, stale)
    MediaAsset.objects.filter(
        pk__in=[
            Recording.objects.get(pk=stale.data["recording"]["id"]).video_asset_id,
            voice.data["voice_asset_id"],
        ]
    ).update(created_at=hours_ago(25))

    call_command("orphan_sweeper")

    swept = Recording.objects.get(pk=stale.data["recording"]["id"])
    assert swept.status == RecordingStatus.FAILED and swept.failure_reason == "upload_abandoned"
    assert swept.deleted_at is not None
    assert not storage.exists(stale.data["upload"]["bucket"], stale.data["upload"]["path"])
    assert MediaAsset.objects.get(pk=voice.data["voice_asset_id"]).status == MediaStatus.DELETED
    assert Recording.objects.get(pk=fresh.data["recording"]["id"]).status == "uploading"
    assert Recording.objects.get(pk=done["id"]).status == "ready"
    assert ledger_total(profile) == len(WEBM) + 7000
    call_command("orphan_sweeper")  # idempotent
    assert ledger_total(profile) == len(WEBM) + 7000


def test_orphan_window_is_configurable(cloud_user, settings):
    client, _ = cloud_user
    created = create_recording(client)
    settings.MEDIA_ORPHAN_HOURS = 0
    assert recordings.sweep_orphans(timezone.now() + dt.timedelta(minutes=1)) == 1
    assert Recording.objects.get(pk=created.data["recording"]["id"]).status == "failed"


# --- account deletion ---------------------------------------------------------------------------


def test_purge_profile_media_queues_a_full_removal(cloud_user, storage, anon):
    client, profile = cloud_user
    rec = saved_recording(client, storage)
    voice = ready_voice(client, storage)
    link = share(client, rec["id"])
    recordings.purge_profile_media(profile)
    assert client.get(f"{API}/recordings/").data["count"] == 0
    assert ShareLink.objects.get(pk=link.data["id"]).revoked_at is not None
    assert anon.get(f"{API}/public/r/{link.data['url'].rsplit('/', 1)[1]}/").status_code == 410

    call_command("expire_recordings")
    assert ledger_total(profile) == 0
    assert Recording.objects.get(pk=rec["id"]).status == RecordingStatus.DELETED
    assert MediaAsset.objects.get(pk=voice).status == MediaStatus.DELETED
    assert not storage.objects
