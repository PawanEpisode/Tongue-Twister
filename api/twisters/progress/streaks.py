"""Streak rules (decisions D4, D16, D17). This module is the only place they live.

``advance`` is the one write path; it is called from ``practice.services`` the first time a local day
qualifies, with the caller holding the Profile row lock. Everything else here is a pure read.

A day qualifies with a scored attempt or a Read-along pass of at least ``READ_ALONG_MIN_ACTIVE_MS``.
A saved recording does not (D17). The streak is a cache on ``Profile``: the stored value is never
rewritten just because time passed, so ``effective_streak`` decides what to show.
"""

import datetime as dt

from django.conf import settings

from ..localtime import local_date, local_hour
from ..models import DailyActivity, Profile

ONE_DAY = dt.timedelta(days=1)


def _freeze_bridges(profile: Profile, gap_days: int) -> bool:
    """A freeze bridges exactly one missed day: the gap to the last active day is two."""
    return gap_days == 2 and profile.streak_freezes > 0


def effective_streak(profile: Profile, today: dt.date) -> int:
    """The streak as a user should see it today: alive through yesterday, or through the day before
    when a banked freeze would bridge the gap, otherwise lapsed (0)."""
    last = profile.last_activity_date
    if last is None or profile.current_streak == 0:
        return 0
    gap = (today - last).days
    if gap <= 1 or _freeze_bridges(profile, gap):
        return profile.current_streak
    return 0


def next_milestone(streak: int) -> int | None:
    """The next milestone strictly above ``streak``; ``None`` once every milestone is behind."""
    return next((m for m in sorted(settings.STREAK_MILESTONES) if m > streak), None)


def practised_today(profile: Profile, today: dt.date) -> bool:
    return profile.last_activity_date == today


def is_at_risk(profile: Profile, now: dt.datetime | None = None) -> bool:
    """A live streak, nothing qualifying yet today, and the local evening has begun."""
    today = local_date(profile, now)
    return (
        effective_streak(profile, today) > 0
        and not practised_today(profile, today)
        and local_hour(profile, now) >= settings.STREAK_AT_RISK_HOUR
    )


def _bridge_missed_day(profile: Profile, missed: dt.date) -> None:
    """Spend one freeze on ``missed``; the day keeps ``qualifies_streak=False`` and is marked."""
    profile.streak_freezes -= 1
    row, _ = DailyActivity.objects.get_or_create(profile=profile, local_date=missed)
    row.freeze_used = True
    row.save(update_fields=["freeze_used"])


def _earn_freeze(profile: Profile) -> None:
    if (
        profile.current_streak % settings.STREAK_FREEZE_EVERY == 0
        and profile.streak_freezes < settings.STREAK_FREEZE_MAX
    ):
        profile.streak_freezes += 1


def advance(profile: Profile, day: DailyActivity) -> None:
    """Count ``day`` towards the streak the first time it qualifies. Mutates ``profile`` and ``day``;
    the caller saves both.

    A back-dated (offline) day qualifies but cannot move the streak, which only ever grows by one per
    new local day. A freeze is earned each time the streak reaches a multiple of ``STREAK_FREEZE_EVERY``;
    because this runs once per day, the same day can never earn two.
    """
    if day.qualifies_streak:
        return
    day.qualifies_streak = True
    last = profile.last_activity_date
    if last is not None and day.local_date <= last:
        return
    gap = None if last is None else (day.local_date - last).days
    if gap == 1:
        profile.current_streak += 1
    elif gap is not None and _freeze_bridges(profile, gap):
        _bridge_missed_day(profile, day.local_date - ONE_DAY)
        profile.current_streak += 1
    else:
        profile.current_streak = 1
    profile.best_streak = max(profile.best_streak, profile.current_streak)
    profile.last_activity_date = day.local_date
    _earn_freeze(profile)
