"""Ask the worker to prepare a recording for analysis (spec 13 A2.3).

All this slice does is queue an `analyse` job; the worker extracts a 16 kHz mono WAV and the API keeps
it (`Recording.audio_asset`) for a few days. Turning that audio into an `Attempt(kind=record)` belongs
to the doc-10 scoring worker and is not built here: the web app still creates the attempt client-side.
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
    return {"status": status, "audio_ready": ready}


def request(profile: Profile, recording: Recording) -> tuple[dict, bool]:
    """Queue analysis (idempotent). Returns (analysis block, created): `created` is False when the audio
    already exists or a job is already waiting/running, which the view reports as 200 + replay."""
    uploads.require_cloud(profile, ConsentType.VOICE_PROCESSING)
    if not settings.MEDIA_PROCESSING_ENABLED:
        raise errors.feature_disabled("Analysis is not available right now.")
    with transaction.atomic():
        fresh = (
            Recording.objects.select_for_update().select_related("audio_asset").get(pk=recording.pk)
        )
        if fresh.status not in (RecordingStatus.READY, RecordingStatus.PROCESSING):
            raise errors.ApiProblem(409, "conflict", "This recording is not ready to analyse.")
        if fresh.video_asset_id is None:
            raise errors.gone()
        created = False
        if not _audio_ready(fresh):
            _, created = jobs.enqueue(fresh, JobKind.ANALYSE, fresh.video_asset)
    return block(fresh), created
