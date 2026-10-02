"""Record analysis becomes an attempt (docs/features/13 A5).

When a recording's 16 kHz analysis WAV is ready the API queues a ``record`` scoring job. The worker scores
the audio against the recording's twister and reports full per-word and per-phoneme verdicts; the API then
creates ``Attempt(kind=record)`` through the same ``service.submit`` path every other attempt takes, so
scoring, XP, streaks, stats and achievements behave identically and the server (not the worker) computes the
score from the verdicts.

Rules this module enforces:

* **One attempt per recording.** ``Recording.attempt`` is one-to-one and the attempt's
  ``client_attempt_id`` is derived from the recording id, so a retry, a duplicate result or a racing client
  can never create a second one.
* **No double XP.** A recording that already has an attempt (the client scored it live and linked it) is
  never enqueued, and a job that finds one at settle time ends ``done`` with ``attempt_exists``.
* **The worker owns its audio.** The analysis WAV belongs to the recording (``ANALYSIS_AUDIO_RETENTION_DAYS``);
  settling a record job never purges it.
* **Inconclusive is not a failure.** Silence, noise or a clip that does not follow the twister end the job
  ``done`` with a reason; the user is told why and no attempt is created.
"""

from __future__ import annotations

import logging
import uuid

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from ..media import consent
from ..models import (
    AcousticModelVersion,
    Attempt,
    ConsentType,
    Engine,
    MediaStatus,
    Profile,
    Recording,
    RecordingStatus,
    ScoringJob,
    ScoringProfile,
    UserPreference,
    Verification,
)
from . import device, service
from .normalise import tokenise

log = logging.getLogger(__name__)

RECORD = ScoringJob.Kind.RECORD
NAMESPACE = uuid.UUID("5d3c6a4e-0b57-4c1e-9b0e-7a0b3a4a2f10")
MAX_QUALITY_KEYS = 12
SETTLED = (ScoringJob.Status.QUEUED, ScoringJob.Status.RUNNING, ScoringJob.Status.DONE)


def client_attempt_id(recording: Recording) -> uuid.UUID:
    """Deterministic, so creating the attempt twice is a replay, not a duplicate."""
    return uuid.uuid5(NAMESPACE, f"record:{recording.pk}")


def active_model() -> tuple[AcousticModelVersion, ScoringProfile] | None:
    model = AcousticModelVersion.objects.filter(active=True).first()
    if model is None:
        return None
    profile = ScoringProfile.objects.filter(active=True, model_version=model).first()
    return (model, profile) if profile else None


def lang_for(profile: Profile) -> str:
    return (
        UserPreference.objects.filter(profile=profile).values_list("accent_lang", flat=True).first()
        or "en-US"
    )


def skip_reason(recording: Recording) -> str | None:
    """Why this recording will not be scored, or None when it should be. Pure reads, no locks."""
    if not settings.RECORD_SCORING_ENABLED:
        return "disabled"
    if recording.status not in (RecordingStatus.READY, RecordingStatus.PROCESSING):
        return "not_ready"
    if recording.attempt_id is not None:
        return "has_attempt"
    audio = recording.audio_asset
    if audio is None or audio.status != MediaStatus.READY:
        return "no_audio"
    if recording.duration_ms > settings.SCORING_MAX_AUDIO_S * 1000:
        return "too_long"
    if consent.active_current(recording.profile, ConsentType.VOICE_PROCESSING) is None:
        return "no_consent"
    if active_model() is None:
        return "no_model"
    return None


def enqueue(recording: Recording) -> ScoringJob | None:
    """Queue scoring of the recording's analysis audio. Idempotent; never raises for a policy reason
    (it returns None), and is safe to call from inside another transaction."""
    if skip_reason(recording) is not None:
        return None
    found = active_model()
    if found is None:  # retired between the check and here
        return None
    model, _ = found
    try:
        with transaction.atomic():
            if recording.scoring_jobs.filter(kind=RECORD, status__in=SETTLED).exists():
                return None  # queued, running, or already scored: never twice
            return ScoringJob.objects.create(
                recording=recording,
                audio_asset=recording.audio_asset,
                kind=RECORD,
                model_version=model,
                max_tries=settings.SCORING_JOB_MAX_TRIES,
            )
    except IntegrityError:  # lost a race to another enqueue
        return None


def block(recording: Recording) -> dict:
    """The `scoring` part of a recording's `analysis` object, so clients can show progress and a reason."""
    attempt = recording.attempt
    if attempt is not None:
        scored = attempt.engine == Engine.WORKER
        return {"status": "scored" if scored else "none", "reason": ""}
    job = recording.scoring_jobs.filter(kind=RECORD).order_by("-created_at").first()
    if job is None:
        reason = skip_reason(recording)
        return {"status": "none", "reason": reason if reason == "too_long" else ""}
    if job.status in ScoringJob.ACTIVE:
        return {"status": job.status, "reason": ""}
    if job.status == ScoringJob.Status.DONE:
        return {"status": "unscorable", "reason": job.error_code}
    return {"status": "failed", "reason": job.error_code}


def build_payload(job: ScoringJob, words: list[dict], profile: ScoringProfile | None) -> dict:
    """Same shape as a spot-check claim (the worker has one parser); `attempt` carries the recording's
    facts and has no device verdicts or audio hash to compare against."""
    rec = job.recording
    twister = rec.twister
    focus = sorted({str(f).upper() for f in (twister.focus_sounds or [])})
    return {
        "attempt": {
            "id": str(rec.pk),
            "duration_ms": rec.duration_ms,
            "device_score": None,
            "audio_sha256": None,
            "lang": lang_for(rec.profile),
            "difficulty": twister.difficulty,
        },
        "twister": {"focus": focus, "words": words},
        "device_words": [],
    }


def _transcript(words: list[device.DeviceWord]) -> str:
    """What the person was heard saying: every expected word that was not missed (display and search only)."""
    return " ".join(w.target for w in sorted(words, key=lambda w: w.index) if w.status != "missed")[
        : service.TEXT_MAX
    ]


def _scalars(quality: object) -> dict:
    if not isinstance(quality, dict):
        return {}
    out: dict = {}
    for key, value in quality.items():
        if len(out) >= MAX_QUALITY_KEYS:
            break
        if isinstance(key, str) and len(key) <= 40 and isinstance(value, bool | int | float):
            if isinstance(value, float) and value != value:  # NaN
                continue
            out[key] = value
    return out


def finish(job: ScoringJob, status: str, code: str = "", **result) -> None:
    now = timezone.now()
    job.status, job.error_code, job.finished_at, job.locked_until = status, code[:40], now, None
    job.tries = max(job.tries, 1)
    job.result = {**job.result, **result}
    job.save()


def settle_done(
    job: ScoringJob,
    profile: Profile,
    *,
    unscorable: str | None,
    words: list[device.DeviceWord],
    duration_ms: int | None,
    summary: dict,
    latency_ms: int | None,
) -> Attempt | None:
    """Apply a worker verdict. The caller holds the job row lock and the profile lock inside a transaction.
    Returns the new attempt, or None when the job ended without one."""
    job.latency_ms = latency_ms
    job.result = {"engine_version": summary.get("engine_version", ""), "unscorable": unscorable}
    recording = (
        Recording.objects.select_for_update(of=("self",))
        .select_related("twister")
        .get(pk=job.recording_id)
    )
    if recording.status == RecordingStatus.DELETED:
        finish(job, ScoringJob.Status.DONE, "recording_gone")
        return None
    if recording.attempt_id is not None:
        finish(job, ScoringJob.Status.DONE, "attempt_exists")
        return None
    if unscorable:
        finish(job, ScoringJob.Status.DONE, unscorable)
        return None
    if not duration_ms or not words:
        finish(job, ScoringJob.Status.DONE, "no_speech")
        return None
    scoring_profile = ScoringProfile.objects.filter(
        active=True, model_version=job.model_version
    ).first()
    submission = service.Submission(
        twister=recording.twister,
        transcript=_transcript(words),
        duration_ms=duration_ms,
        kind="record",
        client_attempt_id=client_attempt_id(recording),
        engine=Engine.WORKER,
        engine_version=str(summary.get("engine_version", ""))[:40],
        lang=lang_for(profile),
        model_version=job.model_version,
        scoring_profile=scoring_profile,
        quality=_scalars(summary.get("quality")),
        device_words=words,
        verification=Verification.VERIFIED,
    )
    try:
        result = service.submit(profile, submission)
    except device.DeviceResultError as exc:
        # The worker's words do not describe this twister (stale twister version, or a bug): never retried.
        log.warning("record_job.invalid_words job=%s reason=%s", job.pk, exc)
        finish(job, ScoringJob.Status.FAILED, "result_invalid")
        return None
    if result.attempt is None:
        finish(job, ScoringJob.Status.DONE, result.unscorable or "no_speech")
        return None
    Recording.objects.filter(pk=recording.pk, attempt__isnull=True).update(attempt=result.attempt)
    finish(job, ScoringJob.Status.DONE, attempt=result.attempt.pk)
    return result.attempt


def expected_token_count(job: ScoringJob) -> int:
    return len(tokenise(job.recording.twister.text))
