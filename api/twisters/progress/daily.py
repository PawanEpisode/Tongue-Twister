"""The featured twister of a UTC day.

A `DailyTwister` row is authoritative: an editor can create one in the admin, and the first request of
a day persists the deterministic pick, so the twister can never change underneath people once it was
shown (adding or unpublishing twisters later does not move today's pick).
"""

import datetime as dt
import re

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError

from ..models import DailyTwister, DailyTwisterSource, Twister

ISO_DAY = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def today_utc(now: dt.datetime | None = None) -> dt.date:
    return (now or timezone.now()).astimezone(dt.UTC).date()


def parse_day(raw: str, today: dt.date) -> dt.date:
    """``?day=YYYY-MM-DD``: today, or up to ``DAILY_LOOKBACK_DAYS`` back. Never the future, so nobody
    can read tomorrow's twister early."""
    try:
        if not ISO_DAY.fullmatch(raw):  # `fromisoformat` also accepts 20260910 and week dates
            raise ValueError(raw)
        day = dt.date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({"day": "Use a date like 2026-10-01."}) from None
    oldest = today - dt.timedelta(days=settings.DAILY_LOOKBACK_DAYS)
    if not oldest <= day <= today:
        raise ValidationError({"day": f"Choose a day from {oldest} to {today}."})
    return day


def auto_pick(day: dt.date) -> int | None:
    """Stable rotation through the published twisters. The rule predates `DailyTwister`, so today's pick
    does not change when this ships."""
    ids = list(Twister.objects.public().order_by("id").values_list("id", flat=True))
    return ids[day.toordinal() % len(ids)] if ids else None


def find_or_create(day: dt.date) -> DailyTwister | None:
    """The row for ``day``, created from the automatic pick if nobody has set one; ``None`` only when
    there are no published twisters. Two requests racing to create it both get the winner's row
    (``get_or_create`` re-reads after a unique violation)."""
    existing = DailyTwister.objects.select_related("twister__category").filter(day=day).first()
    if existing is not None:
        return existing
    twister_id = auto_pick(day)
    if twister_id is None:
        return None
    DailyTwister.objects.get_or_create(
        day=day, defaults={"twister_id": twister_id, "source": DailyTwisterSource.AUTO}
    )
    return DailyTwister.objects.select_related("twister__category").get(day=day)


def daily_twister(day: dt.date) -> DailyTwister:
    row = find_or_create(day)
    if row is None:
        raise NotFound("There are no twisters yet.")
    return row
