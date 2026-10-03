"""The profile timeline: a short, append-only list of moments worth remembering (level-ups, badges,
streak milestones, mastered twisters, personal bests).

Recording is a *side effect* of progress, so it must never cost anyone an attempt: it runs in a
savepoint and any failure is logged and swallowed (same contract as ``achievements.safely``). Each
event has a natural key (``ref``), so recording twice is a no-op.
"""

import datetime as dt
import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ..models import Profile, ProfileEvent, ProfileEventKind

log = logging.getLogger(__name__)


def record(
    profile: Profile,
    kind: str,
    ref: str,
    data: dict | None = None,
    when: dt.datetime | None = None,
) -> None:
    try:
        with transaction.atomic():
            ProfileEvent.objects.bulk_create(
                [
                    ProfileEvent(
                        profile=profile,
                        kind=kind,
                        ref=ref,
                        data=data or {},
                        created_at=when or timezone.now(),
                    )
                ],
                ignore_conflicts=True,
            )
    except Exception:
        log.exception("timeline.record_failed kind=%s profile=%s", kind, profile.pk)


def record_streak_milestone(profile: Profile, streak: int, when: dt.datetime | None = None) -> None:
    if streak in settings.STREAK_MILESTONES:
        record(
            profile, ProfileEventKind.STREAK_MILESTONE, f"streak:{streak}", {"days": streak}, when
        )


def record_attempt_moments(
    profile: Profile,
    *,
    twister_slug: str,
    attempt_id: int,
    score: int,
    when: dt.datetime,
    level_before: int,
    personal_best: bool,
    mastered_now: bool,
    unlocked: list,
) -> None:
    """Everything a single scored attempt can add to the timeline."""
    if profile.level > level_before:
        record(
            profile,
            ProfileEventKind.LEVEL_UP,
            f"level:{profile.level}",
            {"level": profile.level},
            when,
        )
    if mastered_now:
        record(
            profile,
            ProfileEventKind.TWISTER_MASTERED,
            f"mastered:{twister_slug}",
            {"twister": twister_slug},
            when,
        )
    if personal_best:
        record(
            profile,
            ProfileEventKind.PERSONAL_BEST,
            f"best:{attempt_id}",
            {"twister": twister_slug, "score": score},
            when,
        )
    for item in unlocked:
        badge = item.achievement
        record(
            profile,
            ProfileEventKind.ACHIEVEMENT,
            f"ach:{badge.code}",
            {"code": badge.code, "name": badge.name, "tier": badge.tier, "icon": badge.icon},
            item.unlocked_at,
        )
