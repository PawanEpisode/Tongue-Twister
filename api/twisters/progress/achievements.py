"""Achievements rules engine (decision D19).

``evaluate`` is idempotent and state-based: a rule reads the current stats and database, never an
event delta, so an evaluation that was skipped or failed heals itself on the next event. Unlocks are
inserted with ``get_or_create`` against ``UNIQUE(profile, achievement)``, which is what makes a double
evaluation (or two racing requests) grant nothing twice. Rows are never removed by the engine, and a
``revoked`` row still occupies the slot, so a revoked badge is not silently re-granted.

A rule is one function registered with ``@rule``. Adding an achievement that reuses a rule is a
catalogue row only; a new kind of rule is one function here plus its catalogue row.
"""

import datetime as dt
import logging
from collections.abc import Callable
from dataclasses import dataclass
from functools import cached_property

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from ..localtime import local_hour, timezone_confirmed
from ..models import (
    SCORE_VERSION_CURRENT,
    Achievement,
    Attempt,
    AttemptKind,
    Category,
    DailyActivity,
    Profile,
    Recording,
    RecordingStatus,
    Twister,
    UserAchievement,
    public_twister_q,
)
from ..practice import flags
from ..speak import trust
from . import mastery

log = logging.getLogger(__name__)

ACHIEVEMENTS_FLAG = "achievements"
ATTEMPT, SESSION, RECORDING, VIEW = "attempt", "session", "recording", "view"
SCORED_KINDS = (AttemptKind.TEST, AttemptKind.RECORD)


@dataclass
class Event:
    """Something that may have unlocked a badge. ``VIEW`` evaluates nothing new: it only asks for
    progress (see ``catalogue_view``)."""

    kind: str
    profile: Profile
    attempt: Attempt | None = None
    twister: Twister | None = None
    twister_stats: object | None = None
    previous_best: int | None = None


@dataclass(frozen=True)
class Outcome:
    """``progress`` is a 0..1 fraction for counter rules and ``None`` for event rules (no fake meters)."""

    met: bool
    progress: float | None = None


@dataclass(frozen=True)
class Unlocked:
    achievement: Achievement
    unlocked_at: dt.datetime


@dataclass(frozen=True)
class AchievementView:
    achievement: Achievement
    unlocked_at: dt.datetime | None
    progress: float | None
    seen: bool


# --- facts: lazily computed, shared by every rule of one evaluation --------------------------------


class Facts:
    """Current-state questions the rules ask. Each is computed at most once per evaluation, so six
    'master 5 in a category' rules cost one query, not six."""

    def __init__(self, event: Event):
        self.event = event
        self.profile = event.profile

    @cached_property
    def distrusted(self) -> bool:
        return trust.device_distrusted(self.profile)

    def trusted(self, attempt: Attempt) -> bool:
        return trust.is_trusted(attempt, distrusted=self.distrusted)

    def _attempts(self):
        return Attempt.objects.filter(profile=self.profile, flagged=False)

    @cached_property
    def attempts_total(self) -> int:
        return self._attempts().count()

    @cached_property
    def test_attempts(self) -> int:
        return self._attempts().filter(kind=AttemptKind.TEST).count()

    @cached_property
    def mastered(self) -> int:
        return mastery.mastered_count(self.profile)

    @cached_property
    def mastered_by_category(self) -> dict[str, int]:
        return mastery.mastered_by_category(self.profile)

    @cached_property
    def read_along_ms(self) -> int:
        total = DailyActivity.objects.filter(profile=self.profile).aggregate(
            total=Sum("read_along_ms")
        )["total"]
        return total or 0

    @cached_property
    def recordings_saved(self) -> int:
        return Recording.objects.filter(
            profile=self.profile, status=RecordingStatus.READY, deleted_at__isnull=True
        ).count()

    @cached_property
    def category_coverage(self) -> tuple[int, int]:
        """(categories tried, categories that have a published twister)."""
        wanted = set(
            Category.objects.filter(public_twister_q("twisters__")).values_list("pk", flat=True)
        )
        tried = set(
            self._attempts()
            .filter(public_twister_q("twister__"), twister__category__isnull=False)
            .values_list("twister__category_id", flat=True)
            .distinct()
        )
        return len(tried & wanted), len(wanted)

    def passed_difficulties(
        self, min_score: int, difficulties: list[int], verified: bool
    ) -> set[int]:
        """Difficulties with a qualifying Test. A trusted test is looked for in score order and the
        search stops at the first hit, so this stays cheap even for a user with thousands of tests."""
        passed = set()
        for difficulty in difficulties:
            candidates = (
                self._attempts()
                .filter(
                    kind=AttemptKind.TEST,
                    score_version=SCORE_VERSION_CURRENT,
                    score__gte=min_score,
                    twister__difficulty=difficulty,
                )
                .order_by("-score", "id")
            )
            if not verified:
                found = candidates.exists()
            else:
                found = any(self.trusted(a) for a in candidates.iterator(chunk_size=50))
            if found:
                passed.add(difficulty)
        return passed


# --- rule registry ---------------------------------------------------------------------------------

RuleFn = Callable[..., Outcome]


@dataclass(frozen=True)
class Rule:
    fn: RuleFn
    events: frozenset[str]


RULES: dict[str, Rule] = {}


def rule(criteria_type: str, *, events: set[str]) -> Callable[[RuleFn], RuleFn]:
    """Register ``fn(facts, criteria, *, verified) -> Outcome`` for ``criteria.type`` and the events
    that can change its answer."""

    def register(fn: RuleFn) -> RuleFn:
        if criteria_type in RULES:
            raise ValueError(f"duplicate achievement rule {criteria_type!r}")
        RULES[criteria_type] = Rule(fn, frozenset(events))
        return fn

    return register


def _counter(value: int, target: int) -> Outcome:
    target = max(1, target)
    return Outcome(met=value >= target, progress=min(1.0, value / target))


def _scoring_attempt(facts: Facts, criteria: dict, verified: bool) -> Attempt | None:
    """The event's attempt if it is eligible for an attempt-shaped rule, else ``None``."""
    attempt = facts.event.attempt
    if attempt is None or attempt.flagged:
        return None
    if attempt.kind not in criteria.get("kinds", SCORED_KINDS):
        return None
    if verified and not facts.trusted(attempt):
        return None
    twister = facts.event.twister or attempt.twister
    if twister.word_count < criteria.get("min_words", 0):
        return None
    if "difficulty" in criteria and twister.difficulty != criteria["difficulty"]:
        return None
    return attempt


@rule("attempts", events={ATTEMPT})
def _attempts(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    return _counter(facts.attempts_total, criteria["min"])


@rule("test_attempts", events={ATTEMPT})
def _test_attempts(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    return _counter(facts.test_attempts, criteria["min"])


@rule("streak", events={ATTEMPT, SESSION})
def _streak(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    return _counter(facts.profile.best_streak, criteria["min"])


@rule("mastered", events={ATTEMPT})
def _mastered(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    return _counter(facts.mastered, criteria["min"])


@rule("category_mastered", events={ATTEMPT})
def _category_mastered(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    return _counter(facts.mastered_by_category.get(criteria["category"], 0), criteria["min"])


@rule("read_along_ms", events={SESSION})
def _read_along_ms(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    return _counter(facts.read_along_ms, criteria["min"])


@rule("recordings_saved", events={RECORDING})
def _recordings_saved(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    return _counter(facts.recordings_saved, criteria["min"])


@rule("categories_attempted", events={ATTEMPT})
def _categories_attempted(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    tried, wanted = facts.category_coverage
    return Outcome(met=wanted > 0 and tried >= wanted, progress=tried / wanted if wanted else 0.0)


@rule("levels_passed", events={ATTEMPT})
def _levels_passed(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    wanted = criteria["difficulties"]
    passed = facts.passed_difficulties(criteria["min_score"], wanted, verified)
    return _counter(len(passed), len(wanted))


@rule("attempt_score", events={ATTEMPT})
def _attempt_score(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    attempt = _scoring_attempt(facts, criteria, verified)
    return Outcome(met=attempt is not None and attempt.score >= criteria["min"])


@rule("attempt_wpm", events={ATTEMPT})
def _attempt_wpm(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    attempt = _scoring_attempt(facts, criteria, verified)
    return Outcome(
        met=attempt is not None
        and attempt.wpm >= criteria["min"]
        and attempt.accuracy >= criteria.get("min_accuracy", 0.0)
    )


@rule("score_gain", events={ATTEMPT})
def _score_gain(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    attempt = _scoring_attempt(facts, criteria, verified)
    previous = facts.event.previous_best
    return Outcome(
        met=attempt is not None
        and previous is not None
        and attempt.score - previous >= criteria["min"]
    )


def _hour_in_window(hour: int, start: int, end: int) -> bool:
    """``start <= hour < end`` on a 24-hour clock; a window with ``start > end`` wraps midnight."""
    return start <= hour < end if start <= end else hour >= start or hour < end


@rule("attempt_local_hour", events={ATTEMPT})
def _attempt_local_hour(facts: Facts, criteria: dict, *, verified: bool) -> Outcome:
    """The attempt was made inside a window of the user's *own* clock. A profile whose timezone is
    still the unconfirmed default would be judged on UTC, which would hand out Night Owl and Early
    Bird to the wrong people, so those profiles never qualify until a real zone is stored."""
    attempt = _scoring_attempt(facts, criteria, verified)
    if attempt is None or not timezone_confirmed(facts.profile):
        return Outcome(met=False)
    hour = local_hour(facts.profile, attempt.created_at)
    return Outcome(met=_hour_in_window(hour, criteria["from"], criteria["to"]))


# --- evaluation ------------------------------------------------------------------------------------


def _locked_achievements(profile: Profile) -> list[Achievement]:
    """Active badges this profile has no row for (a revoked row counts as a row)."""
    return list(Achievement.objects.filter(active=True).exclude(unlocks__profile=profile))


def evaluate(event: Event) -> list[Unlocked]:
    """Grant every badge the event has just earned and pay its XP. The caller holds the Profile lock
    (XP is a read-modify-write) and owns the transaction; see ``safely`` for the request path."""
    facts = Facts(event)
    unlocked: list[Unlocked] = []
    for achievement in _locked_achievements(event.profile):
        spec = RULES.get(achievement.criteria.get("type"))
        if spec is None:
            log.warning("achievement.unknown_rule code=%s", achievement.code)
            continue
        if event.kind not in spec.events:
            continue
        outcome = spec.fn(facts, achievement.criteria, verified=achievement.verified_only)
        if not outcome.met:
            continue
        row, created = UserAchievement.objects.get_or_create(
            profile=event.profile,
            achievement=achievement,
            defaults={"progress": outcome.progress, "unlocked_at": timezone.now()},
        )
        if created:
            unlocked.append(Unlocked(achievement, row.unlocked_at))
    reward = sum(u.achievement.xp_reward for u in unlocked)
    if reward:
        event.profile.xp += reward
        event.profile.save(update_fields=["xp"])
    return unlocked


def safely(event: Event) -> list[Unlocked]:
    """``evaluate`` for a request path: inside a savepoint, and any failure (a rule bug, a bad catalogue
    row, the database) is logged and swallowed, because a badge must never cost anyone an attempt.
    The in-memory XP is rolled back with the savepoint so the response stays truthful."""
    xp_before = event.profile.xp
    try:
        with transaction.atomic():
            if not flags.enabled(ACHIEVEMENTS_FLAG, event.profile):
                return []
            return evaluate(event)
    except Exception:
        log.exception(
            "achievement.evaluation_failed kind=%s profile=%s", event.kind, event.profile.pk
        )
        event.profile.xp = xp_before
        return []


# --- reads -----------------------------------------------------------------------------------------


def catalogue_view(profile: Profile) -> list[AchievementView]:
    """Every active badge with the profile's state. Locked badges get the same rules' progress, so the
    bars can never disagree with what would actually unlock."""
    achievements = list(Achievement.objects.filter(active=True))
    rows = {
        row.achievement_id: row
        for row in UserAchievement.objects.filter(profile=profile, achievement__in=achievements)
    }
    facts = Facts(Event(VIEW, profile))
    views = []
    for achievement in achievements:
        row = rows.get(achievement.code)
        if row is not None and not row.revoked:
            views.append(AchievementView(achievement, row.unlocked_at, row.progress, row.seen))
            continue
        spec = RULES.get(achievement.criteria.get("type"))
        progress = (
            spec.fn(facts, achievement.criteria, verified=achievement.verified_only).progress
            if spec
            else None
        )
        views.append(AchievementView(achievement, None, progress, False))
    return views


def counts(profile: Profile) -> tuple[int, int]:
    """(unlocked, total) over active badges; a revoked unlock is not unlocked."""
    unlocked = UserAchievement.objects.filter(
        profile=profile, revoked=False, achievement__active=True
    ).count()
    return unlocked, Achievement.objects.filter(active=True).count()


def unseen(profile: Profile) -> list[UserAchievement]:
    return list(
        UserAchievement.objects.filter(
            profile=profile, seen=False, revoked=False, achievement__active=True
        )
        .select_related("achievement")
        .order_by("unlocked_at", "achievement__sort_order")
    )


def mark_seen(profile: Profile, codes: list[str] | None) -> int:
    """Flag toasts as shown. ``None`` means every unseen one; unknown codes simply match nothing."""
    rows = UserAchievement.objects.filter(profile=profile, seen=False, revoked=False)
    if codes is not None:
        rows = rows.filter(achievement_id__in=codes)
    return rows.update(seen=True)


__all__ = [
    "ACHIEVEMENTS_FLAG",
    "ATTEMPT",
    "RECORDING",
    "RULES",
    "SESSION",
    "AchievementView",
    "Event",
    "Outcome",
    "Unlocked",
    "catalogue_view",
    "counts",
    "evaluate",
    "mark_seen",
    "rule",
    "safely",
    "unseen",
]
