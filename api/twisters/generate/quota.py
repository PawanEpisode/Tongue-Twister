"""The daily generation quota (D26): `GENERATE_DAILY_LIMIT` per person per UTC day.

A slot is reserved with one conditional UPDATE before the provider is called, so concurrent requests
cannot overshoot the limit. The slot counts only when a twister is stored, and is handed back on a
rejected result, a provider failure, or a failed insert. Deleting a twister never refunds one.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from django.conf import settings
from django.db.models import F

from ..models import GenerationUsage, Profile
from . import own


@dataclass(frozen=True)
class Quota:
    limit: int
    used: int
    resets_at: dt.datetime
    stored: int = 0
    stored_limit: int = 0

    @property
    def remaining(self) -> int:
        return max(self.limit - self.used, 0)

    def as_dict(self) -> dict:
        return {
            "limit": self.limit,
            "used": self.used,
            "remaining": self.remaining,
            "resets_at": self.resets_at,
            "stored": {
                "limit": self.stored_limit,
                "used": self.stored,
                "remaining": max(self.stored_limit - self.stored, 0),
            },
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
    return Quota(
        settings.GENERATE_DAILY_LIMIT,
        used or 0,
        resets_at(now),
        stored=stored_count(profile),
        stored_limit=settings.GENERATE_MAX_STORED,
    )


def stored_count(profile: Profile) -> int:
    return own.owned(profile).count()


def has_room(profile: Profile) -> bool:
    """Whether the person is under `GENERATE_MAX_STORED` saved twisters."""
    return stored_count(profile) < settings.GENERATE_MAX_STORED


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


def prune(now: dt.datetime) -> int:
    """Delete usage rows older than `GENERATE_USAGE_RETENTION_DAYS`; only today's row matters to the quota,
    the rest is history nobody reads. Returns how many rows went."""
    cutoff = day_of(now) - dt.timedelta(days=settings.GENERATE_USAGE_RETENTION_DAYS)
    return GenerationUsage.objects.filter(day__lt=cutoff).delete()[0]
