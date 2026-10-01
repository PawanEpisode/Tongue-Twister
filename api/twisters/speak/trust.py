"""Trust levels, anti-cheat and spot-checks (decisions D8/D9, docs/features/10 §8)."""

import datetime as dt
import hashlib

from django.conf import settings
from django.utils import timezone

from ..models import (
    AcousticModelVersion,
    Attempt,
    AttemptKind,
    Engine,
    Profile,
    ScoringJob,
    Verification,
)
from ..practice import flags
from .normalise import tokenise

SPOT_CHECK_FLAG = "spot_checks"
DISTRUST_WINDOW = dt.timedelta(days=30)


def device_distrusted(profile: Profile, now: dt.datetime | None = None) -> bool:
    """Repeated spot-check disagreement switches a user's device results off (they fall back to practice)."""
    since = (now or timezone.now()) - DISTRUST_WINDOW
    disagreements = Attempt.objects.filter(
        profile=profile, spot_checked=True, flagged=True, created_at__gte=since
    ).count()
    return disagreements >= settings.DEVICE_DISTRUST_AFTER


def initial_verification(engine: str, distrusted: bool) -> str:
    """Clients can only claim `none` or `device`; `verified` is granted by the worker alone."""
    if engine == Engine.ONDEVICE and not distrusted:
        return Verification.DEVICE
    return Verification.NONE


def is_trusted(attempt: Attempt, *, distrusted: bool) -> bool:
    """Can this attempt's score be believed (D5/D8)? Kind and score thresholds are the caller's business.

    A verified result always; a device result from a trusted user (pending and failed-to-verify keep
    the device result, because a worker outage must not cost users progress); a provisional text-layer
    result only while `MASTERY_ALLOW_PROVISIONAL` is on and the recogniser was confident enough.
    """
    if attempt.flagged or attempt.score_version < 2:
        return False
    status = attempt.verification_status
    if status == Verification.VERIFIED:
        return True
    if status in (Verification.DEVICE, Verification.PENDING, Verification.FAILED):
        return not distrusted
    if status == Verification.NONE and settings.MASTERY_ALLOW_PROVISIONAL:
        confidence = attempt.engine_confidence
        return confidence is None or confidence >= settings.MASTERY_PROVISIONAL_MIN_CONFIDENCE
    return False


def counts_for_mastery(attempt: Attempt, *, distrusted: bool) -> bool:
    """D5/D8: a trusted test at or above the mastery score."""
    if attempt.kind != AttemptKind.TEST or attempt.score < settings.MASTERY_MIN_SCORE:
        return False
    return is_trusted(attempt, distrusted=distrusted)


def is_transcript_spam(
    profile: Profile, twister_id: int, transcript: str, now: dt.datetime
) -> bool:
    """The same words submitted over and over on one twister (scripted score farming)."""
    since = now - dt.timedelta(minutes=settings.SPAM_WINDOW_MIN)
    wanted = tokenise(transcript)
    recent = Attempt.objects.filter(
        profile=profile, twister_id=twister_id, created_at__gte=since
    ).values_list("transcript", flat=True)[: settings.SPAM_TRANSCRIPT_LIMIT * 4]
    same = sum(1 for t in recent if tokenise(t) == wanted)
    return same >= settings.SPAM_TRANSCRIPT_LIMIT


def _bucket(attempt: Attempt) -> float:
    """Stable 0..1 value per attempt, so 'about 10 %' is reproducible and testable."""
    return int(hashlib.sha256(str(attempt.public_id).encode()).hexdigest()[:8], 16) / 0x1_0000_0000


def wants_spot_check(attempt: Attempt, *, is_personal_best: bool) -> bool:
    if attempt.kind != AttemptKind.TEST or attempt.verification_status != Verification.DEVICE:
        return False
    if is_personal_best and attempt.score >= settings.SPOT_CHECK_MIN_SCORE:
        return True
    return _bucket(attempt) < settings.SPOT_CHECK_RATE


def schedule_spot_check(attempt: Attempt, profile: Profile) -> ScoringJob | None:
    """Queue a worker re-score. No-op when spot-checks are off or no acoustic model is published."""
    if not flags.enabled(SPOT_CHECK_FLAG, profile):
        return None
    model = attempt.model_version or AcousticModelVersion.objects.filter(active=True).first()
    if model is None:
        return None
    attempt.verification_status = Verification.PENDING
    attempt.save(update_fields=["verification_status"])
    return ScoringJob.objects.create(
        attempt=attempt, kind=ScoringJob.Kind.SPOT_CHECK, model_version=model
    )
