"""A profile's local clock. 'Today' is always the profile's timezone, never the server's or the request's."""

import datetime as dt
from zoneinfo import ZoneInfo

from django.utils import timezone

from .models import Profile


def tzinfo_for(profile: Profile) -> ZoneInfo:
    return ZoneInfo(profile.timezone)


def local_now(profile: Profile, now: dt.datetime | None = None) -> dt.datetime:
    return (now or timezone.now()).astimezone(tzinfo_for(profile))


def local_date(profile: Profile, now: dt.datetime | None = None) -> dt.date:
    return local_now(profile, now).date()


def day_bounds(profile: Profile, first: dt.date, last: dt.date) -> tuple[dt.datetime, dt.datetime]:
    """Half-open UTC-aware interval ``[start, end)`` covering local days ``first..last`` inclusive."""
    tz = tzinfo_for(profile)
    start = dt.datetime.combine(first, dt.time.min, tzinfo=tz)
    end = dt.datetime.combine(last + dt.timedelta(days=1), dt.time.min, tzinfo=tz)
    return start, end
