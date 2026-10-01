"""Per-user aggregates kept in the same transaction as the attempt (ERD 06b write rules).

Callers hold the Profile row lock (``select_for_update``), so these read-modify-write helpers
cannot race. Every aggregate can be rebuilt from attempts (``rebuild_*``); a nightly
``reconcile_speak_stats`` does that, and deleting an attempt calls the same code.
"""

import datetime as dt
from collections.abc import Iterable, Sequence
from functools import reduce
from operator import or_

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from ..localtime import local_date
from ..models import (
    Attempt,
    AttemptKind,
    AttemptPhoneme,
    PhonemeVerdict,
    Profile,
    Twister,
    UserPhonemeStat,
    UserTwisterStats,
    UserWordStat,
    Verification,
    WordStatus,
)
from . import trust
from .normalise import tokenise

# Share of a word occurrence that counts as an error (near is half-forgiven, like its 0.6 credit).
ERROR_WEIGHT = {
    WordStatus.CORRECT: 0.0,
    WordStatus.NEAR: 0.4,
    WordStatus.WRONG: 1.0,
    WordStatus.MISSED: 1.0,
}
RECENT_WEIGHT, LIFETIME_WEIGHT = 0.6, 0.4
ONE_DAY = dt.timedelta(days=1)
DELETED = "-"

WordOutcome = tuple[str, str]  # (normalised target word, status)
PhonemeObservation = tuple[str, str | None, str]  # (target, heard or None if deleted, verdict)


# --- words ---------------------------------------------------------------------------------------


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def graduates(kind: str, confidence: float | None) -> bool:
    """Does a (correct or close) word in this attempt count as nailing it? Only a drill the
    recogniser was sure about does; a shaky match is not a pass."""
    return kind == AttemptKind.DRILL and (
        confidence is None or confidence >= settings.DRILL_MIN_CONFIDENCE
    )


def apply_word_outcome(
    stat: UserWordStat, status: str, when: dt.datetime, *, graduate: bool = False
) -> None:
    """One occurrence of a word. weakness = 0.6 * recent_error_rate + 0.4 * lifetime_error_rate.

    ``graduate``: this occurrence came from a confident drill, so a correct or close word is nailed.
    A wrong or missed word, from any attempt, takes the word out of 'nailed' again.
    """
    stat.seen += 1
    setattr(stat, status, getattr(stat, status) + 1)
    error = ERROR_WEIGHT[status]
    alpha = settings.WORD_WEAKNESS_RECENT_ALPHA
    stat.recent_error_rate = (
        error if stat.seen == 1 else (1 - alpha) * stat.recent_error_rate + alpha * error
    )
    lifetime = (stat.near * ERROR_WEIGHT[WordStatus.NEAR] + stat.wrong + stat.missed) / stat.seen
    stat.weakness = _clamp(RECENT_WEIGHT * stat.recent_error_rate + LIFETIME_WEIGHT * lifetime)
    stat.last_seen_at = when
    if status in (WordStatus.WRONG, WordStatus.MISSED):
        stat.mastered_at = None
    elif graduate and status in (WordStatus.CORRECT, WordStatus.NEAR):
        stat.mastered_at = when

    ladder = settings.WEAK_WORD_LADDER_DAYS
    if status == WordStatus.CORRECT:
        stat.streak_correct = min(stat.streak_correct + 1, 32767)
        days = ladder[min(stat.streak_correct, len(ladder)) - 1]
        stat.next_review_at = when + dt.timedelta(days=days)
    else:
        if status != WordStatus.NEAR:
            stat.streak_correct = 0  # near neither advances nor resets the ladder
        stat.next_review_at = when + ONE_DAY * ladder[0]


def apply_words(
    profile: Profile,
    outcomes: Iterable[WordOutcome],
    when: dt.datetime,
    *,
    graduate: bool = False,
) -> None:
    outcomes = list(outcomes)
    if not outcomes:
        return
    graduate = graduate and len(outcomes) == 1  # a drill is one word; anything else is not
    rows = {
        r.word_norm: r
        for r in UserWordStat.objects.filter(
            profile=profile, word_norm__in={w for w, _ in outcomes}
        )
    }
    created: dict[str, UserWordStat] = {}
    for word, status in outcomes:
        stat = rows.get(word) or created.get(word)
        if stat is None:
            stat = created[word] = UserWordStat(profile=profile, word_norm=word[:64])
        apply_word_outcome(stat, status, when, graduate=graduate)
    UserWordStat.objects.bulk_create(created.values())
    UserWordStat.objects.bulk_update(
        rows.values(),
        [
            "seen",
            "correct",
            "near",
            "wrong",
            "missed",
            "recent_error_rate",
            "weakness",
            "last_seen_at",
            "next_review_at",
            "streak_correct",
            "mastered_at",
        ],
    )


# --- phonemes ------------------------------------------------------------------------------------

_ERRORS = {PhonemeVerdict.SUBSTITUTED, PhonemeVerdict.DELETED}


def apply_phonemes(profile: Profile, observations: Sequence[PhonemeObservation]) -> None:
    """`S>S` rows count every observation of a target sound; `S>SH` / `S>-` rows count its errors.

    `uncertain` verdicts are ignored (a false accusation costs more than a missed slip, D10).
    """
    observed = [o for o in observations if o[2] != PhonemeVerdict.UNCERTAIN]
    if not observed:
        return
    targets = {t for t, _, _ in observed}
    prefixes = reduce(or_, (Q(phoneme_pair__startswith=f"{t}>") for t in sorted(targets)))
    rows = {r.phoneme_pair: r for r in UserPhonemeStat.objects.filter(prefixes, profile=profile)}

    def row(pair: str) -> UserPhonemeStat:
        if pair not in rows:
            rows[pair] = UserPhonemeStat(profile=profile, phoneme_pair=pair)
        return rows[pair]

    for target, heard, verdict in observed:
        row(f"{target}>{target}").occurrences += 1
        if verdict in _ERRORS:
            error_row = row(f"{target}>{heard or DELETED}")
            error_row.occurrences += 1
            error_row.errors += 1

    for pair, r in rows.items():
        target = pair.split(">", 1)[0]
        if target in targets and r.errors:
            total = rows[f"{target}>{target}"].occurrences
            r.error_rate = _clamp(r.errors / total)
    now = timezone.now()
    for r in rows.values():
        r.updated_at = now  # bulk_update skips auto_now
    UserPhonemeStat.objects.bulk_create([r for r in rows.values() if r.pk is None])
    UserPhonemeStat.objects.bulk_update(
        [r for r in rows.values() if r.pk is not None],
        ["occurrences", "errors", "error_rate", "updated_at"],
    )


# --- per-twister stats & mastery -----------------------------------------------------------------


def apply_mastery_day(stats: UserTwisterStats, day: dt.date, when: dt.datetime) -> None:
    """Distinct qualifying local days within MASTERY_WINDOW_DAYS; `mastered_at` is never cleared."""
    last = stats.mastery_last_day
    if last == day:
        return
    window = dt.timedelta(days=settings.MASTERY_WINDOW_DAYS)
    stats.mastery_days_hit = (
        1 if last is None or day - last > window else stats.mastery_days_hit + 1
    )
    stats.mastery_last_day = day
    if stats.mastered_at is None and stats.mastery_days_hit >= settings.MASTERY_DAYS:
        stats.mastered_at = when


def apply_attempt_to_stats(
    profile: Profile, stats: UserTwisterStats, attempt: Attempt, *, distrusted: bool
) -> None:
    """Fold one attempt (the newest so far) into the twister stats. Does not save."""
    when = attempt.created_at
    stats.attempts_count += 1
    stats.first_attempt_at = stats.first_attempt_at or when
    stats.last_attempt_at = when
    stats.last_score = attempt.score
    if attempt.kind != AttemptKind.TEST:
        return
    stats.test_attempts_count += 1
    if attempt.flagged or attempt.score_version < 2:
        return
    stats.best_test_score = max(stats.best_test_score or 0, attempt.score)
    if attempt.verification_status == Verification.VERIFIED:
        stats.best_score = max(stats.best_score or 0, attempt.score)
    else:
        stats.best_practice_score = max(stats.best_practice_score or 0, attempt.score)
    if trust.counts_for_mastery(attempt, distrusted=distrusted):
        apply_mastery_day(stats, local_date(profile, when), when)


def rebuild_twister_stats(profile: Profile, twister: Twister) -> UserTwisterStats:
    """Recompute one (user, twister) row from its attempts, oldest first."""
    stats, _ = UserTwisterStats.objects.get_or_create(profile=profile, twister=twister)
    keep = {"id": stats.pk, "profile": profile, "twister": twister}
    fresh = UserTwisterStats(**keep)
    distrusted = trust.device_distrusted(profile)
    for attempt in Attempt.objects.filter(profile=profile, twister=twister).order_by(
        "created_at", "id"
    ):
        apply_attempt_to_stats(profile, fresh, attempt, distrusted=distrusted)
    fresh.save()
    return fresh


def record_attempt(profile: Profile, twister: Twister, attempt: Attempt) -> UserTwisterStats:
    """Incrementally update the row; rebuild it when the attempt is older than the newest one
    (offline queues arrive out of order and mastery depends on day order)."""
    stats = UserTwisterStats.objects.filter(profile=profile, twister=twister).first()
    if stats is None or stats.last_attempt_at is None or attempt.created_at < stats.last_attempt_at:
        return rebuild_twister_stats(profile, twister)
    apply_attempt_to_stats(profile, stats, attempt, distrusted=trust.device_distrusted(profile))
    stats.save()
    return stats


# --- rebuilding everything (reconcile job, attempt deletion) --------------------------------------


def outcomes_from_attempt(
    attempt: Attempt, targets: Sequence[str] | None = None
) -> list[WordOutcome]:
    """Test/Record attempts keep AttemptWord rows; Train/Drill keep `breakdown.words = [[idx, status]]`."""
    rows = [
        (w.target_word, w.status)
        for w in attempt.words.all()
        if w.target_index is not None and w.status != WordStatus.EXTRA
    ]
    if rows or attempt.kind in (AttemptKind.TEST, AttemptKind.RECORD):
        return rows
    words = targets if targets is not None else tokenise(attempt.twister.text)
    return [
        (words[i], status)
        for i, status in attempt.breakdown.get("words", [])
        if isinstance(i, int) and 0 <= i < len(words) and status in ERROR_WEIGHT
    ]


def rebuild_profile_stats(profile: Profile) -> None:
    """Drop and replay every aggregate of one user from their unflagged attempts."""
    UserWordStat.objects.filter(profile=profile).delete()
    UserPhonemeStat.objects.filter(profile=profile).delete()
    attempts = (
        Attempt.objects.filter(profile=profile, flagged=False, score_version__gte=2)
        .select_related("twister")
        .prefetch_related("words__phonemes")
        .order_by("created_at", "id")
    )
    for attempt in attempts.iterator(chunk_size=200):
        apply_words(
            profile,
            outcomes_from_attempt(attempt),
            attempt.created_at,
            graduate=graduates(attempt.kind, attempt.engine_confidence),
        )
        apply_phonemes(profile, phoneme_observations(attempt))
    for twister in Twister.objects.filter(attempts__profile=profile).distinct():
        rebuild_twister_stats(profile, twister)
    UserTwisterStats.objects.filter(profile=profile).exclude(
        twister__in=Twister.objects.filter(attempts__profile=profile)
    ).delete()


def phoneme_observations(attempt: Attempt) -> list[PhonemeObservation]:
    return [
        (p.target_phoneme, p.heard_phoneme or None, p.verdict)
        for w in attempt.words.all()
        for p in w.phonemes.all()
    ]


def phoneme_rows_to_observations(rows: Iterable[AttemptPhoneme]) -> list[PhonemeObservation]:
    return [(p.target_phoneme, p.heard_phoneme or None, p.verdict) for p in rows]
