"""The media-worker queue: enqueue, claim with a lease, heartbeat, retry and sweep.

Concurrency model: a claim is one conditional UPDATE (`status queued -> running`) so two workers can
never both win a job on any database. On PostgreSQL the candidate row is also locked with
`FOR UPDATE SKIP LOCKED`, which lets parallel workers skip each other's rows instead of queueing behind
them; sqlite has no such clause, so it relies on the conditional UPDATE alone.

Nothing here touches storage or quota. Finishing a job with outputs is `processing.apply_processed`.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass

from django.conf import settings
from django.db import IntegrityError, connection, transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework.exceptions import NotFound

from .. import errors
from ..models import (
    JobKind,
    JobStatus,
    MediaAsset,
    MediaJob,
    MediaStatus,
    Recording,
    RecordingStatus,
)

log = logging.getLogger(__name__)

CLAIM_ATTEMPTS = 5  # lost races before a claim gives up for this poll


def lease() -> dt.timedelta:
    return dt.timedelta(seconds=settings.MEDIA_JOB_LEASE_S)


# --- enqueue ------------------------------------------------------------------------------------


def enqueue(recording: Recording, kind: str, asset: MediaAsset) -> tuple[MediaJob, bool]:
    """Queue `kind` work for a recording, or return the one already waiting/running.

    Idempotent through the partial unique index `(recording, kind) WHERE status IN (queued, running)`:
    the insert runs in a savepoint so losing the race is a clean "already there", on every database.
    """
    try:
        with transaction.atomic():
            return MediaJob.objects.create(recording=recording, asset=asset, kind=kind), True
    except IntegrityError:
        return MediaJob.objects.get(
            recording=recording, kind=kind, status__in=MediaJob.ACTIVE
        ), False


# --- claim / heartbeat --------------------------------------------------------------------------


def _candidates():
    """Queued work a worker may take now. Analysis needs a settled (ready) source, because processing
    replaces the source file; a soft-deleted take is left alone (it may still be restored)."""
    return (
        MediaJob.objects.filter(
            status=JobStatus.QUEUED,
            tries__lt=F("max_tries"),
            recording__deleted_at__isnull=True,
        )
        .filter(Q(kind=JobKind.PROCESS) | Q(recording__status=RecordingStatus.READY))
        .order_by("created_at")
    )


def claim(now: dt.datetime | None = None) -> MediaJob | None:
    """Hand the oldest runnable job to a worker under a fresh lease, or None when the queue is idle."""
    now = now or timezone.now()
    sweep_leases(now)
    for _ in range(CLAIM_ATTEMPTS):
        with transaction.atomic():
            rows = _candidates()
            if connection.features.has_select_for_update_skip_locked:
                rows = rows.select_for_update(skip_locked=True, of=("self",))
            job = rows.first()
            if job is None:
                return None
            won = MediaJob.objects.filter(pk=job.pk, status=JobStatus.QUEUED).update(
                status=JobStatus.RUNNING,
                tries=F("tries") + 1,
                locked_until=now + lease(),
                started_at=now,
                error_code="",
            )
        if won:
            job.refresh_from_db()
            _point_analysis_at_current_source(job)
            return job
    return None


def _point_analysis_at_current_source(job: MediaJob) -> None:
    """An analysis job may have been queued while processing was still replacing the source file;
    by the time it runs the recording is ready, so read whichever file is the playback video now."""
    if job.kind != JobKind.ANALYSE:
        return
    current = Recording.objects.values_list("video_asset_id", flat=True).get(pk=job.recording_id)
    if current and current != job.asset_id:
        MediaJob.objects.filter(pk=job.pk).update(asset=current)
        job.asset_id = current


def release_claim(job: MediaJob) -> None:
    """Undo a claim that could not be served (storage was down while building the response): the try
    does not count against the job."""
    MediaJob.objects.filter(pk=job.pk, status=JobStatus.RUNNING).update(
        status=JobStatus.QUEUED, tries=F("tries") - 1, locked_until=None
    )


def heartbeat(job_id, now: dt.datetime | None = None) -> MediaJob:
    """Extend a running job's lease. 404 for an unknown id, 409 `lease_lost` once it is no longer
    running (finished, failed or re-queued), which tells the worker to drop it."""
    now = now or timezone.now()
    extended = MediaJob.objects.filter(pk=job_id, status=JobStatus.RUNNING).update(
        locked_until=now + lease()
    )
    job = MediaJob.objects.filter(pk=job_id).first()
    if job is None:
        raise NotFound()
    if not extended:
        raise errors.ApiProblem(409, "lease_lost", "This job is no longer running.")
    return job


# --- settle -------------------------------------------------------------------------------------


def mark_done(job: MediaJob, now: dt.datetime | None = None) -> None:
    job.transition(
        JobStatus.DONE, finished_at=now or timezone.now(), locked_until=None, error_code=""
    )


def _fail_recording(job: MediaJob, code: str) -> None:
    """A `process` job that is out of tries takes its recording down with it (retry-processing can
    revive it); an `analyse` failure never touches the recording."""
    if job.kind != JobKind.PROCESS:
        return
    recording = Recording.objects.select_for_update().get(pk=job.recording_id)
    if recording.status == RecordingStatus.PROCESSING:
        recording.transition(RecordingStatus.FAILED, failure_reason=code[:60])
    asset = MediaAsset.objects.select_for_update().get(pk=job.asset_id)
    if asset.status == MediaStatus.PROCESSING:
        asset.transition(MediaStatus.FAILED)


def fail(job: MediaJob, code: str, now: dt.datetime | None = None) -> None:
    """Final failure. Caller holds the job row lock and is in a transaction."""
    job.transition(
        JobStatus.FAILED,
        finished_at=now or timezone.now(),
        locked_until=None,
        error_code=code[:60],
    )
    _fail_recording(job, code)


def retry_or_fail(
    job: MediaJob, code: str, *, retryable: bool = True, now: dt.datetime | None = None
) -> str:
    """Put a running job back in the queue if it has tries left, otherwise fail it. Returns the new
    status. Caller holds the job row lock and is in a transaction."""
    if retryable and job.tries < job.max_tries:
        job.transition(JobStatus.QUEUED, locked_until=None, error_code=code[:60])
        return JobStatus.QUEUED
    fail(job, code, now)
    return JobStatus.FAILED


# --- sweeper ------------------------------------------------------------------------------------


@dataclass(frozen=True)
class SweepResult:
    requeued: int = 0
    failed: int = 0
    cancelled: int = 0


def sweep_leases(now: dt.datetime | None = None) -> tuple[int, int]:
    """Jobs running past `locked_until` go back to queued, or fail once `tries` reaches `max_tries`.
    Returns (requeued, failed). Also called at the start of every claim, so a crashed worker's job is
    picked up within one poll interval instead of waiting for the daily sweeper."""
    now = now or timezone.now()
    requeued = failed = 0
    lapsed = MediaJob.objects.filter(status=JobStatus.RUNNING, locked_until__lt=now)
    for job_id in list(lapsed.values_list("pk", flat=True)):
        with transaction.atomic():
            job = MediaJob.objects.select_for_update().get(pk=job_id)
            if job.status != JobStatus.RUNNING or job.locked_until >= now:
                continue  # finished or heartbeated while we were looking
            if retry_or_fail(job, "lease_expired", now=now) == JobStatus.QUEUED:
                requeued += 1
            else:
                failed += 1
    return requeued, failed


def sweep(now: dt.datetime | None = None) -> SweepResult:
    """Lease/retry housekeeping (run from `orphan_sweeper`). Safe to re-run.

    * lapsed leases: see `sweep_leases`;
    * active jobs whose recording was hard-deleted -> failed `source_gone` (nothing left to process).
    """
    now = now or timezone.now()
    requeued, failed = sweep_leases(now)
    cancelled = 0
    dead = MediaJob.objects.filter(
        status__in=MediaJob.ACTIVE, recording__status=RecordingStatus.DELETED
    )
    for job_id in list(dead.values_list("pk", flat=True)):
        with transaction.atomic():
            job = MediaJob.objects.select_for_update().get(pk=job_id)
            if job.status in MediaJob.ACTIVE:
                job.transition(
                    JobStatus.FAILED, finished_at=now, locked_until=None, error_code="source_gone"
                )
                cancelled += 1
    if requeued or failed or cancelled:
        log.info("media.jobs_swept requeued=%s failed=%s cancelled=%s", requeued, failed, cancelled)
    return SweepResult(requeued, failed, cancelled)
