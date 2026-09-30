"""What the media worker sees and reports: the claim payload and the `processed` callback.

Output objects have **deterministic ids and paths per job** (`uuid5(job.id, slot)`), so the API never
trusts a path from the worker: it derives the same path the claim handed out and stats it itself. It also
means a retried upload overwrites the same object and a repeated callback adopts the same asset rows.

Lock order follows the rest of the media code: the owner's Profile row first (`quota.lock_profile`), then
job / recording / asset rows. Storage I/O (verifying outputs, deleting strays) happens outside the lock.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from .. import errors
from ..models import (
    CaptionsSource,
    JobKind,
    JobStatus,
    LedgerReason,
    MediaAsset,
    MediaJob,
    MediaStatus,
    Recording,
    RecordingStatus,
)
from . import jobs, quota, uploads
from .storage import ObjectStat, StorageError

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Slot:
    """One file a job may upload. Bucket, kind and extension come from `uploads.MIME_RULES`."""

    mime: str

    @property
    def rule(self) -> uploads.MimeRule:
        return uploads.MIME_RULES[self.mime]


SLOTS = {
    "mp4": Slot("video/mp4"),
    "thumbnail": Slot("image/jpeg"),
    "captions": Slot("text/vtt"),
    "audio": Slot("audio/wav"),
}
JOB_OUTPUTS = {
    JobKind.PROCESS: ("mp4", "thumbnail", "captions"),
    JobKind.ANALYSE: ("audio",),
}
# Files made by the server, not typed by the user: bound by the global object ceiling only.
_SERVER_MADE_LIMIT = {"audio": lambda: settings.MEDIA_MAX_BYTES}


def output_asset_id(job: MediaJob, slot: str) -> uuid.UUID:
    return uuid.uuid5(job.pk, slot)


def output_path(job: MediaJob, slot: str) -> str:
    return uploads.object_path(
        job.recording.profile_id, output_asset_id(job, slot), SLOTS[slot].rule.ext, job.created_at
    )


# --- claim --------------------------------------------------------------------------------------


def _words(recording: Recording) -> list[dict] | None:
    if not recording.attempt_id:
        return None
    rows = recording.attempt.words.filter(target_index__isnull=False).order_by("target_index")
    return [
        {"target": w.target_word, "start_ms": w.start_ms, "end_ms": w.end_ms, "status": w.status}
        for w in rows
    ]


def claim_payload(job: MediaJob) -> dict:
    """The worker's instructions for a claimed job: a signed source URL, one signed upload per output
    slot and (for `process`) the word timings to caption. Signed URLs are returned, never logged."""
    recording = Recording.objects.select_related("attempt").get(pk=job.recording_id)
    job.recording = recording
    source = MediaAsset.objects.get(pk=job.asset_id)
    ttl = settings.MEDIA_WORKER_URL_TTL_S
    outputs = {}
    for name in JOB_OUTPUTS[job.kind]:
        slot = SLOTS[name]
        signed = uploads.mint_upload(
            slot.rule.bucket, output_path(job, name), slot.mime, ttl_s=ttl, upsert=True
        )
        outputs[name] = {
            "bucket": signed.bucket,
            "path": signed.path,
            "upload_url": signed.standard_url,
            "token": signed.token,
            "mime": slot.mime,
        }
    return {
        "id": job.pk,
        "kind": job.kind,
        "recording_id": job.recording_id,
        "asset_id": job.asset_id,
        "lease_s": settings.MEDIA_JOB_LEASE_S,
        "source": {
            "url": uploads.mint_download(source.bucket, source.path, ttl),
            "mime": source.mime_type,
            "size_bytes": source.size_bytes,
        },
        "outputs": outputs,
        "words": _words(recording) if job.kind == JobKind.PROCESS else None,
        "limits": {
            "max_height": settings.MEDIA_WORKER_MAX_HEIGHT,
            "max_s": settings.MEDIA_JOB_MAX_RUN_S,
        },
    }


def claim_next() -> dict | None:
    """`POST /internal/media/claim/`: take a job and build its payload; if the payload cannot be built
    (storage down) the claim is handed back so the job is not penalised."""
    job = jobs.claim()
    if job is None:
        return None
    try:
        return claim_payload(job)
    except (errors.ApiProblem, StorageError):
        jobs.release_claim(job)
        raise


# --- processed callback -------------------------------------------------------------------------


def _job_for(asset: MediaAsset, job_id) -> MediaJob:
    """The job this callback is about. Without `job_id` (older callers) it is the recording's latest
    `process` job on this asset."""
    qs = MediaJob.objects.select_related("recording").filter(asset=asset)
    job = (
        qs.filter(pk=job_id).first()
        if job_id
        else qs.filter(kind=JobKind.PROCESS).order_by("-created_at").first()
    )
    if job is None:
        raise NotFound()
    return job


def _replay_or_conflict(job: MediaJob, ready: bool) -> tuple[MediaJob, bool]:
    """A settled job answers a repeat with the same result; a contradicting report is a conflict."""
    matches = (job.status == JobStatus.DONE) == ready
    if job.status in (JobStatus.DONE, JobStatus.FAILED) and not matches:
        raise errors.ApiProblem(409, "job_closed", "This job has already finished differently.")
    return job, False


def _verify_outputs(job: MediaJob, names: list[str]) -> tuple[dict[str, ObjectStat], str | None]:
    """Stat + sniff every declared output (storage I/O, no locks). Raises 409 when one is missing;
    returns (verified stats, first rejection reason or None)."""
    stats: dict[str, ObjectStat] = {}
    for name in names:
        slot = SLOTS[name]
        probe = MediaAsset(
            profile_id=job.recording.profile_id,
            kind=slot.rule.kind,
            bucket=slot.rule.bucket,
            path=output_path(job, name),
            mime_type=slot.mime,
        )
        limit = _SERVER_MADE_LIMIT.get(name)
        try:
            stats[name] = uploads.verify_object(probe, max_bytes=limit() if limit else None)
        except uploads.UploadRejected as exc:
            return stats, exc.reason
    return stats, None


def _facts(body: dict, recording: Recording, *assets: MediaAsset) -> None:
    """Copy worker-measured duration/size onto the recording and the playback asset(s)."""
    for field in ("duration_ms", "width", "height"):
        value = body.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            continue
        for asset in assets:
            setattr(asset, field, value)
        cap = 600_000 if field == "duration_ms" else 32_767
        setattr(recording, field, min(value, cap))
    for asset in assets:
        asset.save(update_fields=["duration_ms", "width", "height"])
    recording.save(update_fields=["duration_ms", "width", "height"])


def _register(
    profile, job: MediaJob, name: str, stat: ObjectStat, *, expires_at=None
) -> MediaAsset | None:
    """Create (or find, on a repeat) the asset row for one verified output and charge it. Returns None
    when it does not fit the owner's quota (the caller deletes the object)."""
    slot = SLOTS[name]
    asset_id = output_asset_id(job, name)
    asset = MediaAsset.objects.filter(pk=asset_id).first()
    if asset is None:
        try:
            quota.check_can_hold(profile, quota.limits_for(profile), stat.size)
        except errors.ApiProblem:
            return None
        asset = MediaAsset.objects.create(
            id=asset_id,
            profile=profile,
            kind=slot.rule.kind,
            bucket=slot.rule.bucket,
            path=output_path(job, name),
            mime_type=slot.mime,
            size_bytes=stat.size,
            checksum_sha256=stat.checksum_sha256 or "",
            status=MediaStatus.READY,
            expires_at=expires_at,
        )
    if quota.asset_balance(asset) == 0 and asset.status == MediaStatus.READY:
        quota.charge_stored(
            profile, asset, quota.LEDGER_KIND_BY_ASSET[asset.kind], stat.size, LedgerReason.COMPLETE
        )
    return asset


def _adopt_process_outputs(
    profile, job: MediaJob, recording: Recording, stats: dict[str, ObjectStat]
) -> list[MediaAsset]:
    """Attach thumbnail/captions/transcode. Returns assets whose object must be deleted again
    (did not fit the quota, or the recording already has one)."""
    unused: list[MediaAsset] = []
    source = recording.video_asset
    for name, field in (("thumbnail", "thumbnail_asset"), ("captions", "captions_asset")):
        if name not in stats:
            continue
        if getattr(recording, f"{field}_id"):
            unused.append(_stray(job, name))
            continue
        asset = _register(profile, job, name, stats[name])
        if asset is None:
            unused.append(_stray(job, name))
            continue
        setattr(recording, field, asset)
        if name == "captions":
            recording.captions_source = CaptionsSource.ALIGNMENT
    if "mp4" in stats and source is not None:
        growth = stats["mp4"].size - quota.asset_balance(source)
        fits = True
        if growth > 0:
            try:
                quota.check_can_hold(profile, quota.limits_for(profile), growth)
            except errors.ApiProblem:
                fits = False
        asset = _register(profile, job, "mp4", stats["mp4"]) if fits else None
        if asset is None:
            unused.append(_stray(job, "mp4"))
        else:
            recording.video_asset = asset
            recording.mime_type = asset.mime_type
            recording.size_bytes = asset.size_bytes
    return unused


def _stray(job: MediaJob, name: str) -> MediaAsset:
    """An unsaved handle on an uploaded-but-unused object, enough for `uploads.discard_object`."""
    slot = SLOTS[name]
    return MediaAsset(bucket=slot.rule.bucket, path=output_path(job, name))


def _discard(assets: list[MediaAsset]) -> None:
    for asset in assets:
        uploads.discard_object(asset)


def _finish_ready(
    job: MediaJob, body: dict, stats: dict[str, ObjectStat]
) -> tuple[list[MediaAsset], bool]:
    """Apply a successful result inside the transaction. Returns (objects to delete afterwards,
    whether the recording is gone); never raises, so the job's own state change is always committed."""
    recording = Recording.objects.select_for_update().get(pk=job.recording_id)
    source = MediaAsset.objects.select_for_update().get(pk=job.asset_id)
    if recording.status == RecordingStatus.DELETED or source.status == MediaStatus.DELETED:
        jobs.fail(job, "source_gone")
        return [_stray(job, n) for n in stats], True
    profile = recording.profile
    unused: list[MediaAsset] = []
    if job.kind == JobKind.PROCESS:
        unused = _adopt_process_outputs(profile, job, recording, stats)
        playback = recording.video_asset
        _facts(body, recording, *([playback] if playback else [source]))
        recording.save(
            update_fields=[
                "video_asset",
                "mime_type",
                "size_bytes",
                "thumbnail_asset",
                "captions_asset",
                "captions_source",
            ]
        )
        if source.status == MediaStatus.PROCESSING:
            source.transition(MediaStatus.READY)
        if recording.status == RecordingStatus.PROCESSING:
            recording.transition(RecordingStatus.READY, failure_reason="")
    elif "audio" not in stats:
        jobs.retry_or_fail(job, "audio_missing")
        return unused, False
    else:
        expires = timezone.now() + dt.timedelta(days=settings.ANALYSIS_AUDIO_RETENTION_DAYS)
        asset = _register(profile, job, "audio", stats["audio"], expires_at=expires)
        if asset is None:
            unused.append(_stray(job, "audio"))
            jobs.fail(job, "quota_exceeded")
            return unused, False
        recording.audio_asset = asset
        recording.save(update_fields=["audio_asset"])
    jobs.mark_done(job)
    return unused, False


def apply_processed(asset: MediaAsset, body: dict) -> tuple[MediaJob, bool]:
    """Apply the worker's report for the job that read `asset` (idempotent).

    Returns (job, changed); `changed` is False for a repeat of a settled result. Raises 409
    `upload_incomplete` when a declared output is not in storage yet and 422 `upload_rejected` when one
    is not what its type says (the job is then retried/failed like any failure).
    """
    ready = body["status"] == "ready"
    job = _job_for(asset, body.get("job_id"))
    names = body.get("outputs") or []
    if not set(names) <= set(JOB_OUTPUTS[job.kind]):
        raise ValidationError({"outputs": f"A {job.kind} job may upload {JOB_OUTPUTS[job.kind]}."})
    if job.status in (JobStatus.DONE, JobStatus.FAILED):
        return _replay_or_conflict(job, ready)
    if not ready and job.status != JobStatus.RUNNING:
        return job, False  # a duplicate failure report for a job that was already re-queued

    stats: dict[str, ObjectStat] = {}
    rejection: str | None = None
    if ready:
        stats, rejection = _verify_outputs(job, names)

    unused: list[MediaAsset] = []
    failure: errors.ApiProblem | None = None
    gone = False
    with transaction.atomic():
        quota.lock_profile(asset.profile)
        locked = (
            MediaJob.objects.select_for_update(of=("self",))
            .select_related("recording")
            .get(pk=job.pk)
        )
        if locked.status in (JobStatus.DONE, JobStatus.FAILED):
            return _replay_or_conflict(locked, ready)
        if rejection is not None:
            unused = [_stray(locked, n) for n in names]
            jobs.retry_or_fail(locked, f"output_{rejection}", now=timezone.now())
            failure = uploads.upload_rejected(rejection)
        elif ready:
            unused, gone = _finish_ready(locked, body, stats)
        else:
            code = str(body.get("error") or "processing_failed")[:60]
            jobs.retry_or_fail(
                locked, code, retryable=body.get("retryable", True) is not False, now=None
            )
    _discard(unused)
    if failure is not None:
        raise failure
    if gone:
        raise errors.gone("This recording no longer exists.")
    purge_replaced_sources()
    return MediaJob.objects.get(pk=job.pk), True


# --- clean-up of transcoded originals -----------------------------------------------------------


def purge_replaced_sources() -> int:
    """Delete the original upload once a transcode has replaced it as the playback file, releasing its
    bytes. Best effort here; the `orphan_sweeper` runs it again so a storage hiccup cannot leak quota."""
    replaced = (
        MediaJob.objects.filter(kind=JobKind.PROCESS, status=JobStatus.DONE)
        .exclude(asset_id=F("recording__video_asset_id"))
        .exclude(asset__status=MediaStatus.DELETED)
        .select_related("asset__profile")
    )
    return sum(1 for job in replaced if uploads.purge_asset(job.asset, LedgerReason.DELETE))
