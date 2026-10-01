"""Builds the `GET /me/stats/` and `GET /me/activity/` bodies (spec 14 S4.1).

Days are the profile's *local* streak days (`localtime`: its timezone, plus the night owl boundary), so a 23:30
attempt and a 00:30 attempt across midnight land on different days whatever UTC says. Everything is
aggregated in SQL per day; Python only merges days into series and never touches attempt rows.
"""

import datetime as dt
from collections.abc import Iterable
from dataclasses import dataclass

from django.conf import settings
from django.db.models import Avg, Count, Min, Sum

from ..localtime import day_bounds, day_expr, local_date
from ..models import SCORE_VERSION_CURRENT, Attempt, AttemptKind, DailyActivity, Profile
from ..speak import queries
from . import mastery

ROLLING_DAYS = 7
WEAK_WORDS_LIMIT = 10
RANGE_DAYS = {"7d": 7, "30d": 30, "90d": 90}
ALL = "all"

# mode -> attempt kinds that count as attempts / that feed scores. Train and drill score only part of
# a twister, so they would skew averages; they still count as practice.
COUNTED_KINDS: dict[str | None, tuple[str, ...]] = {
    None: tuple(AttemptKind.values),
    "speak_score": (AttemptKind.TEST, AttemptKind.TRAIN, AttemptKind.DRILL),
    "record": (AttemptKind.RECORD,),
    "read_along": (),
}
SCORED_KINDS: dict[str | None, tuple[str, ...]] = {
    None: (AttemptKind.TEST, AttemptKind.RECORD),
    "speak_score": (AttemptKind.TEST,),
    "record": (AttemptKind.RECORD,),
    "read_along": (),
}
INCLUDES_READ_ALONG = {None, "read_along"}


@dataclass
class _Day:
    """Everything one local day (or, after bucketing, one ISO week) contributes to any series."""

    date: dt.date
    attempts: int = 0
    active_ms: int = 0
    scored: int = 0
    score_total: int = 0
    wpm_total: float = 0.0

    def absorb(self, other: "_Day") -> None:
        self.attempts += other.attempts
        self.active_ms += other.active_ms
        self.scored += other.scored
        self.score_total += other.score_total
        self.wpm_total += other.wpm_total


def _round(value: float, places: int = 1) -> float:
    return round(value, places)


# --- window ----------------------------------------------------------------------------------------


def _first_active_day(profile: Profile, today: dt.date) -> dt.date:
    """Start of the `all` range: the earliest attempt or activity row, else today."""
    first_attempt = Attempt.objects.filter(profile=profile).aggregate(first=Min("created_at"))[
        "first"
    ]
    first_row = DailyActivity.objects.filter(profile=profile).aggregate(first=Min("local_date"))[
        "first"
    ]
    candidates = [d for d in (first_row,) if d]
    if first_attempt:
        candidates.append(local_date(profile, first_attempt))
    return min(candidates, default=today)


def resolve_window(profile: Profile, range_: str, today: dt.date) -> tuple[dt.date, dt.date]:
    """Inclusive local ``(first, last)`` for a `range` value."""
    if range_ == ALL:
        return _first_active_day(profile, today), today
    return today - dt.timedelta(days=RANGE_DAYS[range_] - 1), today


# --- per-day aggregation ---------------------------------------------------------------------------


def _attempts(profile: Profile, first: dt.date, last: dt.date, kinds: Iterable[str]):
    start, end = day_bounds(profile, first, last)
    return Attempt.objects.filter(
        profile=profile,
        flagged=False,
        kind__in=list(kinds),
        created_at__gte=start,
        created_at__lt=end,
    )


def _daily(profile: Profile, qs):
    return qs.annotate(day=day_expr(profile)).values("day")


def _collect_days(
    profile: Profile, first: dt.date, last: dt.date, mode: str | None
) -> dict[dt.date, _Day]:
    days: dict[dt.date, _Day] = {}

    def day(date: dt.date) -> _Day:
        return days.setdefault(date, _Day(date))

    counted = _attempts(profile, first, last, COUNTED_KINDS[mode])
    for row in _daily(profile, counted).annotate(n=Count("pk"), ms=Sum("duration_ms")):
        entry = day(row["day"])
        entry.attempts, entry.active_ms = row["n"], row["ms"] or 0

    scored = _attempts(profile, first, last, SCORED_KINDS[mode]).filter(
        score_version=SCORE_VERSION_CURRENT
    )
    for row in _daily(profile, scored).annotate(n=Count("pk"), total=Sum("score"), wpm=Sum("wpm")):
        entry = day(row["day"])
        entry.scored, entry.score_total, entry.wpm_total = row["n"], row["total"], row["wpm"]

    if mode in INCLUDES_READ_ALONG:
        read_along = DailyActivity.objects.filter(
            profile=profile, local_date__range=(first, last), read_along_ms__gt=0
        )
        for row in read_along:
            entry = day(row.local_date)
            entry.active_ms += row.read_along_ms
            if mode == "read_along":  # there are no attempts to count: a finished pass is the unit
                entry.attempts += row.read_along_passes
    return days


def _week_start(date: dt.date) -> dt.date:
    return date - dt.timedelta(days=date.weekday())


def _bucket_weekly(days: list[_Day]) -> list[_Day]:
    weeks: dict[dt.date, _Day] = {}
    for d in days:
        weeks.setdefault(_week_start(d.date), _Day(_week_start(d.date))).absorb(d)
    return [weeks[k] for k in sorted(weeks)]


def _fit(days: dict[dt.date, _Day], first: dt.date, last: dt.date) -> list[_Day]:
    """Days oldest first; ranges longer than STATS_MAX_POINTS days are bucketed by ISO week, and the
    result never exceeds the cap (the most recent points win)."""
    ordered = [days[k] for k in sorted(days)]
    if (last - first).days + 1 > settings.STATS_MAX_POINTS:
        ordered = _bucket_weekly(ordered)
    return ordered[-settings.STATS_MAX_POINTS :]


# --- series ----------------------------------------------------------------------------------------


def rolling_means(points: list[_Day]) -> list[float]:
    """7-day trailing mean of the score, weighted by how many attempts each day had. Only days that
    have scores are passed in, so a quiet stretch does not drag the line towards zero."""
    out, left, count, total = [], 0, 0, 0
    for point in points:
        count += point.scored
        total += point.score_total
        while (point.date - points[left].date).days >= ROLLING_DAYS:
            count -= points[left].scored
            total -= points[left].score_total
            left += 1
        out.append(total / count)
    return out


def _score_series(points: list[_Day]) -> list[dict]:
    scored = [p for p in points if p.scored]
    return [
        {
            "date": p.date.isoformat(),
            "avg": _round(p.score_total / p.scored),
            "rolling": _round(rolling),
            "count": p.scored,
        }
        for p, rolling in zip(scored, rolling_means(scored), strict=True)
    ]


def _speed_series(points: list[_Day]) -> list[dict]:
    return [
        {"date": p.date.isoformat(), "avg_wpm": _round(p.wpm_total / p.scored)}
        for p in points
        if p.scored
    ]


def _attempts_series(points: list[_Day]) -> list[dict]:
    return [
        {"date": p.date.isoformat(), "attempts": p.attempts, "active_ms": p.active_ms}
        for p in points
        if p.attempts or p.active_ms
    ]


def _category_accuracy(profile: Profile, first: dt.date, last: dt.date, mode: str | None):
    scored = _attempts(profile, first, last, SCORED_KINDS[mode]).filter(
        score_version=SCORE_VERSION_CURRENT, twister__category__isnull=False
    )
    rows = (
        scored.values(
            "twister__category__slug", "twister__category__name", "twister__category__sort_order"
        )
        .annotate(avg=Avg("accuracy"), n=Count("pk"))
        .order_by("twister__category__sort_order", "twister__category__name")
    )
    return [
        {
            "category": r["twister__category__slug"],
            "name": r["twister__category__name"],
            "avg_accuracy": _round(r["avg"], 3),
            "attempts": r["n"],
        }
        for r in rows
    ]


def _weak_words(profile: Profile) -> list[dict]:
    return [
        {"word": r["word"], "miss_rate": r["miss_rate"], "seen": r["seen"], "drill": r["drill"]}
        for r in queries.weak_word_rows(profile, limit=WEAK_WORDS_LIMIT)
    ]


def stats(profile: Profile, range_: str, mode: str | None, now: dt.datetime) -> dict:
    today = local_date(profile, now)
    first, last = resolve_window(profile, range_, today)
    days = _collect_days(profile, first, last, mode)
    points = _fit(days, first, last)
    scored = sum(d.scored for d in days.values())
    return {
        "range": range_,
        "mode": mode,
        "from": first.isoformat(),
        "to": last.isoformat(),
        "kpis": {
            "attempts": sum(d.attempts for d in days.values()),
            "practice_ms": sum(d.active_ms for d in days.values()),
            "avg_score": _round(sum(d.score_total for d in days.values()) / scored)
            if scored
            else None,
            "best_streak": profile.best_streak,
            "mastered": mastery.mastered_count(profile),
            "xp": profile.xp,
            "level": profile.level,
        },
        "score_series": _score_series(points),
        "speed_series": _speed_series(points),
        "attempts_by_day": _attempts_series(points),
        "category_accuracy": _category_accuracy(profile, first, last, mode),
        "weak_words": _weak_words(profile),
    }


def activity(profile: Profile, weeks: int, now: dt.datetime) -> dict:
    """The heatmap feed: only days that have a row, Monday-aligned start so the grid has whole weeks."""
    today = local_date(profile, now)
    first = _week_start(today) - dt.timedelta(weeks=weeks - 1)
    rows = DailyActivity.objects.filter(profile=profile, local_date__range=(first, today)).order_by(
        "local_date"
    )
    return {
        "from": first.isoformat(),
        "to": today.isoformat(),
        "days": [
            {
                "date": r.local_date.isoformat(),
                "attempts": r.attempts,
                "active_ms": r.active_ms,
                "read_along_ms": r.read_along_ms,
                "qualifies_streak": r.qualifies_streak,
                "freeze_used": r.freeze_used,
            }
            for r in rows
        ],
    }
