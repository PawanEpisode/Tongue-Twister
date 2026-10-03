"""Builds the `GET /me/summary/` body: everything the home strip and header chip need in one request."""

import datetime as dt

from ..levels import level_progress
from ..localtime import local_date
from ..models import DailyActivity, Profile, Twister, UserPreference
from . import achievements, mastery, streaks
from .serializers import UnseenAchievementSerializer


def daily_goal(profile: Profile, today: dt.date) -> dict:
    """Today's progress towards the optional attempts goal (``target`` 0 = no goal set)."""
    target = (
        UserPreference.objects.filter(profile=profile)
        .values_list("daily_goal_attempts", flat=True)
        .first()
        or 0
    )
    done = (
        DailyActivity.objects.filter(profile=profile, local_date=today)
        .values_list("attempts", flat=True)
        .first()
        or 0
    )
    return {"target": target, "done": done, "met": bool(target) and done >= target}


def build(profile: Profile, now: dt.datetime) -> dict:
    today = local_date(profile, now)
    streak = streaks.effective_streak(profile, today)
    unlocked, total_achievements = achievements.counts(profile)
    xp_in_level, xp_for_next_level = level_progress(profile.xp)
    return {
        "mastered": mastery.mastered_count(profile),
        "total": Twister.objects.public().count(),
        "current_streak": streak,
        "best_streak": profile.best_streak,
        "streak_at_risk": streaks.is_at_risk(profile, now),
        "streak_freezes": profile.streak_freezes,
        "next_streak_milestone": streaks.next_milestone(streak),
        "practised_today": streaks.practised_today(profile, today),
        "achievements": {"unlocked": unlocked, "total": total_achievements},
        "xp": profile.xp,
        "level": profile.level,
        "xp_in_level": xp_in_level,
        "xp_for_next_level": xp_for_next_level,
        "timezone": profile.timezone,
        "night_owl": profile.night_owl,
        "deletion_scheduled_for": profile.deletion_scheduled_for,
        "daily_goal": daily_goal(profile, today),
        "today": today.isoformat(),
        "unseen_achievements": UnseenAchievementSerializer(
            achievements.unseen(profile), many=True
        ).data,
    }
