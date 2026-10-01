"""Builds the `GET /me/summary/` body: everything the home strip and header chip need in one request."""

import datetime as dt

from ..levels import level_progress
from ..localtime import local_date
from ..models import Profile, Twister
from . import achievements, mastery, streaks
from .serializers import UnseenAchievementSerializer


def build(profile: Profile, now: dt.datetime) -> dict:
    today = local_date(profile, now)
    streak = streaks.effective_streak(profile, today)
    unlocked, total_achievements = achievements.counts(profile)
    xp_in_level, xp_for_next_level = level_progress(profile.xp)
    return {
        "mastered": mastery.mastered_count(profile),
        "total": Twister.objects.filter(is_published=True).count(),
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
        "today": today.isoformat(),
        "unseen_achievements": UnseenAchievementSerializer(
            achievements.unseen(profile), many=True
        ).data,
    }
