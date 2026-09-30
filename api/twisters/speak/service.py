"""Record a Speak & Score attempt. One code path for live, offline-queue and guest-import submissions.

The caller owns the transaction and holds the ``Profile`` row lock (``select_for_update``); everything
here (idempotency check, personal best, XP, streak, stats) relies on that to be race-free.
"""

import datetime as dt
import uuid
from collections.abc import Collection
from dataclasses import dataclass, field

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Max, Q
from django.utils import timezone

from .. import errors
from .. import scoring as legacy
from ..models import (
    SCORE_VERSION_CURRENT,
    AcousticModelVersion,
    Attempt,
    AttemptKind,
    AttemptPhoneme,
    AttemptWord,
    Engine,
    PracticeSession,
    Profile,
    ScoringProfile,
    Twister,
    TwisterPronunciation,
    UserTwisterStats,
    WordStatus,
)
from ..practice import services
from . import device, pipeline, stats, trust
from . import scoring as v2
from .normalise import tokenise

PERSISTED_WORDS = {AttemptKind.TEST, AttemptKind.RECORD}
TEXT_MAX = 4000


@dataclass(frozen=True)
class SpokenMeta:
    """What the recogniser said about one spoken word (confidence and timing)."""

    confidence: float | None = None
    start_ms: int | None = None
    end_ms: int | None = None


@dataclass
class Submission:
    """A validated attempt, independent of the transport it arrived on."""

    twister: Twister
    transcript: str
    duration_ms: int
    kind: str = AttemptKind.TEST
    long_pause_ms: int = 0
    client_attempt_id: uuid.UUID | None = None
    session: PracticeSession | None = None
    engine: str = Engine.TEXT_LAYER
    engine_version: str = ""
    confidence: float | None = None
    lang: str = ""
    model_version: AcousticModelVersion | None = None
    scoring_profile: ScoringProfile | None = None
    nonce: uuid.UUID | None = None
    audio_sha256: str | None = None
    quality: dict = field(default_factory=dict)
    device_words: list[device.DeviceWord] = field(default_factory=list)
    spoken_meta: dict[int, SpokenMeta] = field(default_factory=dict)
    voice_asset_id: uuid.UUID | None = None
    occurred_at: dt.datetime | None = (
        None  # offline/guest imports; live submissions use the server clock
    )
    earns_progress: bool = True  # guest imports earn neither XP nor streak (decision D12)


@dataclass
class Result:
    attempt: Attempt | None = None
    created: bool = False
    unscorable: str | None = None
    personal_best: bool = False
    level_up: bool = False
    mastered_now: bool = False
    warning: str | None = None


def accepted_variants(twister: Twister, lang: str) -> dict[str, set[str]]:
    """word -> spoken forms counted correct, from global and per-twister pronunciation rows."""
    rows = TwisterPronunciation.objects.filter(
        Q(twister=twister) | Q(twister__isnull=True)  # `__in=[twister, None]` never matches NULL
    ).exclude(accepted_variants=[])
    accepted: dict[str, set[str]] = {}
    for row in rows:
        if row.accent and row.accent != lang:
            continue
        for variant in row.accepted_variants:
            tokens = tokenise(str(variant))
            if len(tokens) == 1:
                accepted.setdefault(row.word, set()).add(tokens[0])
    return accepted


def _spoken_index_meta(words, meta: dict[int, SpokenMeta]):
    for w in words:
        yield w, meta.get(w.spoken_index) if w.spoken_index is not None else None


def _word_rows(attempt: Attempt, evaluation, submission: Submission, reports) -> list[AttemptWord]:
    rows = []
    for aligned, spoken in _spoken_index_meta(evaluation.words, submission.spoken_meta):
        report = reports.get(aligned.target_index) if aligned.target_index is not None else None
        rows.append(
            AttemptWord(
                attempt=attempt,
                target_index=aligned.target_index,
                spoken_index=aligned.spoken_index,
                target_word=aligned.target_word[:64],
                spoken_word=aligned.spoken_word[:64],
                status=aligned.status,
                reason=aligned.reason,
                credit=v2.credit_for(aligned.status),
                confidence=report.confidence
                if report and report.confidence is not None
                else (spoken.confidence if spoken else None),
                acoustic_score=report.acoustic_score if report else None,
                phoneme_distance=report.phoneme_distance if report else None,
                start_ms=report.start_ms
                if report and report.start_ms is not None
                else (spoken.start_ms if spoken else None),
                end_ms=report.end_ms
                if report and report.end_ms is not None
                else (spoken.end_ms if spoken else None),
            )
        )
    return rows


def _phoneme_rows(word_rows: Collection[AttemptWord], reports) -> list[AttemptPhoneme]:
    out = []
    for row in word_rows:
        report = reports.get(row.target_index) if row.target_index is not None else None
        for idx, p in enumerate(report.phonemes if report else []):
            out.append(
                AttemptPhoneme(
                    attempt_word=row,
                    idx=idx,
                    target_phoneme=p.target,
                    heard_phoneme=p.heard or "",
                    variant_used=p.variant,
                    verdict=p.verdict,
                    delta=p.delta,
                    lpp=p.lpp,
                    lpr=p.lpr,
                    start_ms=p.start_ms,
                    end_ms=p.end_ms,
                )
            )
    return out


def _breakdown(evaluation) -> dict:
    counts = evaluation.score.counts
    return {
        **counts,
        "words": [
            [w.target_index, w.status] for w in evaluation.words if w.target_index is not None
        ],
    }


def _personal_best(
    profile: Profile, submission: Submission, score: int, when, flagged: bool
) -> bool:
    """Best among *earlier* unflagged v2 tests (offline attempts may arrive out of order)."""
    if submission.kind != AttemptKind.TEST or flagged:
        return False
    previous = Attempt.objects.filter(
        profile=profile,
        twister=submission.twister,
        kind=AttemptKind.TEST,
        flagged=False,
        score_version=SCORE_VERSION_CURRENT,
        created_at__lt=when,
    ).aggregate(best=Max("score"))["best"]
    return previous is None or score > previous


def _award(submission: Submission, evaluation, flagged: bool, when, now) -> int | None:
    """XP for this attempt, or None when it earns no progress at all (no XP, no streak day):
    guest imports (D12), flagged attempts, and offline attempts too old to reward."""
    if flagged or not submission.earns_progress:
        return None
    if now - when > dt.timedelta(days=settings.OFFLINE_XP_MAX_AGE_DAYS):
        return None
    base = legacy.attempt_xp(
        evaluation.score.score, submission.twister.difficulty, evaluation.score.accuracy
    )
    return round(base * settings.XP_KIND_MULTIPLIER.get(submission.kind, 1.0))


def _check_replay_tokens(profile: Profile, submission: Submission) -> None:
    if (
        submission.nonce
        and Attempt.objects.filter(profile=profile, nonce=submission.nonce).exists()
    ):
        raise errors.nonce_invalid()
    if (
        submission.audio_sha256
        and Attempt.objects.filter(audio_sha256=submission.audio_sha256).exists()
    ):
        raise errors.audio_hash_duplicate()


def replay(attempt: Attempt) -> Result:
    return Result(attempt=attempt, created=False, personal_best=attempt.is_personal_best)


def submit(profile: Profile, submission: Submission, now: dt.datetime | None = None) -> Result:
    now = now or timezone.now()
    if submission.client_attempt_id:
        existing = Attempt.objects.filter(
            profile=profile, client_attempt_id=submission.client_attempt_id
        ).first()
        if existing:
            return replay(existing)

    twister = submission.twister
    evaluation = pipeline.evaluate(
        twister.text,
        submission.transcript,
        duration_ms=submission.duration_ms,
        long_pause_ms=submission.long_pause_ms,
        difficulty=twister.difficulty,
        focus_sounds=twister.focus_sounds,
        accepted=accepted_variants(twister, submission.lang),
    )
    reports: dict[int, device.DeviceWord] = {}
    if submission.device_words:
        evaluation, reports = device.merge(
            evaluation, tokenise(twister.text), submission.device_words
        )
    reason = pipeline.unscorable_reason(
        evaluation, confidence=submission.confidence, quality=submission.quality
    )
    if reason:
        return Result(unscorable=reason)
    _check_replay_tokens(profile, submission)

    when = submission.occurred_at or now
    spam = trust.is_transcript_spam(profile, twister.id, submission.transcript, when)
    flagged = bool(evaluation.flags) or spam
    warning = evaluation.flags[0] if evaluation.flags else ("repeated_transcript" if spam else None)
    distrusted = trust.device_distrusted(profile, now)
    score = evaluation.score
    is_best = _personal_best(profile, submission, score.score, when, flagged)
    xp = _award(submission, evaluation, flagged, when, now)
    gop = [r.acoustic_score for r in reports.values() if r.acoustic_score is not None]

    try:
        with transaction.atomic():
            attempt = Attempt.objects.create(
                profile=profile,
                twister=twister,
                session=submission.session,
                kind=submission.kind,
                transcript=submission.transcript[:TEXT_MAX],
                accuracy=score.accuracy,
                speed_score=score.speed,
                fluency_score=score.fluency,
                gop_score=round(sum(gop) / len(gop), 2) if gop else None,
                completeness=score.completeness,
                duration_ms=submission.duration_ms,
                long_pause_ms=evaluation.long_pause_ms,
                wpm=score.wpm,
                score=score.score,
                score_version=SCORE_VERSION_CURRENT,
                xp_awarded=xp or 0,
                client_attempt_id=submission.client_attempt_id,
                engine=submission.engine,
                engine_version=submission.engine_version,
                engine_confidence=submission.confidence,
                model_version=submission.model_version,
                scoring_profile=submission.scoring_profile,
                nonce=submission.nonce,
                audio_sha256=submission.audio_sha256,
                quality=submission.quality,
                lang=submission.lang,
                verification_status=trust.initial_verification(submission.engine, distrusted),
                is_personal_best=is_best,
                flagged=flagged,
                breakdown={} if submission.kind in PERSISTED_WORDS else _breakdown(evaluation),
                voice_asset_id=submission.voice_asset_id,
            )
    except IntegrityError:
        # Lost a race on a unique key; the profile lock makes this rare, and the winner is authoritative.
        existing = Attempt.objects.filter(
            profile=profile, client_attempt_id=submission.client_attempt_id
        ).first()
        if existing and submission.client_attempt_id:
            return replay(existing)
        raise errors.nonce_invalid() from None

    if submission.occurred_at:  # auto_now_add ignores create() kwargs
        Attempt.objects.filter(pk=attempt.pk).update(created_at=when)
        attempt.created_at = when

    if submission.kind in PERSISTED_WORDS:
        rows = _word_rows(attempt, evaluation, submission, reports)
        AttemptWord.objects.bulk_create(rows)
        AttemptPhoneme.objects.bulk_create(_phoneme_rows(rows, reports))

    old_level = profile.level
    if xp is not None:
        services.record_attempt(profile, xp, when)

    if not flagged:
        outcomes = [
            (w.target_word, w.status)
            for w in evaluation.words
            if w.target_index is not None and w.status != WordStatus.EXTRA
        ]
        stats.apply_words(profile, outcomes, when)
        stats.apply_phonemes(
            profile,
            [(p.target, p.heard, p.verdict) for r in reports.values() for p in r.phonemes],
        )
    before = (
        UserTwisterStats.objects.filter(profile=profile, twister=twister)
        .values_list("mastered_at", flat=True)
        .first()
    )
    twister_stats = stats.record_attempt(profile, twister, attempt)

    if trust.wants_spot_check(attempt, is_personal_best=is_best):
        trust.schedule_spot_check(attempt, profile)

    return Result(
        attempt=attempt,
        created=True,
        personal_best=is_best,
        level_up=profile.level > old_level,
        mastered_now=before is None and twister_stats.mastered_at is not None,
        warning=warning,
    )


def delete_attempt(profile: Profile, attempt: Attempt) -> None:
    """Remove an attempt and its children, then rebuild every aggregate it fed.

    XP and streak days already earned are kept: history is editable, achievements are not.
    """
    attempt.delete()
    stats.rebuild_profile_stats(profile)
