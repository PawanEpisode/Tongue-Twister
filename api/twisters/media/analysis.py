"""Ask the worker to prepare a recording for analysis (spec 13 A2.3).

Queues an `analyse` job; the worker extracts a 16 kHz mono WAV and the API keeps it
(`Recording.audio_asset`) for a few days. When that audio lands, `speak.record_jobs` queues a `record`
scoring job that turns it into `Attempt(kind=record)` (A5), unless the client already linked an attempt.
"""

from __future__ import annotations

from django.conf import settings
from django.db import transaction

from .. import errors
from ..models import (
    ConsentType,
    JobKind,
    JobStatus,
    MediaStatus,
    Profile,
    Recording,
    RecordingStatus,
)
from . import jobs, uploads

# active/failed job status -> what the client is told (done is 'ready' only while the audio exists)
_CLIENT_STATUS = {
    JobStatus.QUEUED: "queued",
    JobStatus.RUNNING: "running",
    JobStatus.FAILED: "failed",
}


def _audio_ready(recording: Recording) -> bool:
    asset = recording.audio_asset
    return asset is not None and asset.status == MediaStatus.READY


def block(recording: Recording) -> dict:
    """The `analysis` object of a recording. `none` = never requested (or the audio was purged and no
    job is pending), so clients can always read `analysis.status`."""
    job = recording.jobs.filter(kind=JobKind.ANALYSE).order_by("-created_at").first()
    ready = _audio_ready(recording)
    if ready:
        status = "ready"
    elif job is None or job.status == JobStatus.DONE:  # done but the audio was purged: start over
        status = "none"
    else:
        status = _CLIENT_STATUS[job.status]
    from ..speak import record_jobs  # local: speak imports media

    return {"status": status, "audio_ready": ready, "scoring": record_jobs.block(recording)}


def request(profile: Profile, recording: Recording) -> tuple[dict, bool]:
    """Queue analysis (idempotent). Returns (analysis block, created): `created` is False when the audio
    already exists or a job is already waiting/running, which the view reports as 200 + replay."""
    uploads.require_cloud(profile, ConsentType.VOICE_PROCESSING)
    if not settings.MEDIA_PROCESSING_ENABLED:
        raise errors.feature_disabled("Analysis is not available right now.")
    with transaction.atomic():
        fresh = (
            Recording.objects.select_for_update(of=("self",))
            .select_related("audio_asset")
            .get(pk=recording.pk)
        )
        if fresh.status not in (RecordingStatus.READY, RecordingStatus.PROCESSING):
            raise errors.ApiProblem(409, "conflict", "This recording is not ready to analyse.")
        if fresh.video_asset_id is None:
            raise errors.gone()
        created = False
        if not _audio_ready(fresh):
            _, created = jobs.enqueue(fresh, JobKind.ANALYSE, fresh.video_asset)
        else:  # audio already there (e.g. scoring was switched on later): queue the scoring now
            from ..speak import record_jobs

            record_jobs.enqueue(fresh)
    return block(fresh), created
