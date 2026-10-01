"""The daily generation quota (D26): `GENERATE_DAILY_LIMIT` per person per UTC day.

A slot is reserved with one conditional UPDATE before the provider is called, so concurrent requests
cannot overshoot the limit. A slot is spent when the provider is asked (a rejected twister still cost
money) and handed back only when the provider itself failed, so deleting a twister never refunds one.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from django.conf import settings
from django.db.models import F

from ..models import GenerationUsage, Profile


@dataclass(frozen=True)
class Quota:
    limit: int
    used: int
    resets_at: dt.datetime

    @property
    def remaining(self) -> int:
        return max(self.limit - self.used, 0)

    def as_dict(self) -> dict:
        return {
            "limit": self.limit,
            "used": self.used,
            "remaining": self.remaining,
            "resets_at": self.resets_at,
        }


def day_of(now: dt.datetime) -> dt.date:
    return now.astimezone(dt.UTC).date()


def resets_at(now: dt.datetime) -> dt.datetime:
    """The next UTC midnight."""
    tomorrow = day_of(now) + dt.timedelta(days=1)
    return dt.datetime.combine(tomorrow, dt.time.min, tzinfo=dt.UTC)


def status(profile: Profile, now: dt.datetime) -> Quota:
    used = (
        GenerationUsage.objects.filter(profile=profile, day=day_of(now))
        .values_list("count", flat=True)
        .first()
    )
    return Quota(settings.GENERATE_DAILY_LIMIT, used or 0, resets_at(now))


def reserve(profile: Profile, now: dt.datetime) -> bool:
    """Take one slot; False when today's limit is already reached."""
    day = day_of(now)
    GenerationUsage.objects.get_or_create(profile=profile, day=day)
    taken = GenerationUsage.objects.filter(
        profile=profile, day=day, count__lt=settings.GENERATE_DAILY_LIMIT
    ).update(count=F("count") + 1)
    return taken == 1


def release(profile: Profile, now: dt.datetime) -> None:
    GenerationUsage.objects.filter(profile=profile, day=day_of(now), count__gt=0).update(
        count=F("count") - 1
    )
