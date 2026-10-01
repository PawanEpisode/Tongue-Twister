"""A profile's local clock. 'Today' is always the profile's timezone, never the server's or the request's.

Night owl mode (decision D23) moves the *streak day boundary* from midnight to ``NIGHT_OWL_CUTOFF_HOUR``
for opted-in profiles: activity between 00:00 and 02:59 counts for the previous local day. The shift
lives here and only here. Streaks, ``DailyActivity``, mastery days, the summary and the insights all ask
``local_date`` / ``day_bounds`` / ``day_expr``, so they cannot disagree. ``local_now`` and ``local_hour``
stay the real wall clock: "is it evening?" and "was that a 2 a.m. attempt?" are about the clock, not
about which streak day it belongs to.

SQL aggregation shifts by a fixed duration, so on the two DST-change nights of the year an attempt in the
hour next to the 03:00 boundary can fall on the neighbouring day in a *chart* (never in a streak, which
uses the exact wall-clock rule below).
"""

import datetime as dt
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db.models import DateTimeField, ExpressionWrapper, F
from django.db.models.expressions import Combinable
from django.db.models.functions import TruncDate
from django.utils import timezone

from .models import Profile


def tzinfo_for(profile: Profile) -> ZoneInfo:
    return ZoneInfo(profile.timezone)


def timezone_confirmed(profile: Profile) -> bool:
    """Whether `Profile.timezone` was actually chosen (`PATCH /me/`) rather than the `UTC` default.
    Clock-based rules must not trust an unconfirmed zone; a person who confirmed `UTC` is trusted."""
    return profile.timezone_confirmed


def local_now(profile: Profile, now: dt.datetime | None = None) -> dt.datetime:
    """The profile's wall clock (not shifted by night owl mode)."""
    return (now or timezone.now()).astimezone(tzinfo_for(profile))


def local_hour(profile: Profile, now: dt.datetime | None = None) -> int:
    return local_now(profile, now).hour


def day_offset(profile: Profile) -> dt.timedelta:
    """How far the streak day boundary sits after local midnight."""
    return (
        dt.timedelta(hours=settings.NIGHT_OWL_CUTOFF_HOUR) if profile.night_owl else dt.timedelta()
    )


def local_date(profile: Profile, now: dt.datetime | None = None) -> dt.date:
    """The streak day ``now`` belongs to. Wall-clock arithmetic, so it is exact across DST changes."""
    return (local_now(profile, now) - day_offset(profile)).date()


def day_bounds(profile: Profile, first: dt.date, last: dt.date) -> tuple[dt.datetime, dt.datetime]:
    """Half-open UTC-aware interval ``[start, end)`` covering streak days ``first..last`` inclusive."""
    tz = tzinfo_for(profile)
    boundary = (dt.datetime.min + day_offset(profile)).time()
    start = dt.datetime.combine(first, boundary, tzinfo=tz)
    end = dt.datetime.combine(last + dt.timedelta(days=1), boundary, tzinfo=tz)
    return start, end


def day_expr(profile: Profile, field: str = "created_at") -> Combinable:
    """Database expression for the streak day of a datetime column (same rule as ``local_date``)."""
    offset = day_offset(profile)
    source = ExpressionWrapper(F(field) - offset, output_field=DateTimeField()) if offset else field
    return TruncDate(source, tzinfo=tzinfo_for(profile))
