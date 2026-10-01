"""Practice reminders by e-mail (D27): preferences, who is due, and sending.

Selection, per run (hourly at :07):

* the flag ``reminders`` is on for that person, the preference is ``enabled``, the account is not pending
  deletion (``active_profile_q``) and has an e-mail address, and the profile's timezone has been
  confirmed (``localtime.timezone_confirmed``: a profile still on the ``UTC`` placeholder would be mailed
  at the wrong hour);
* the profile's **wall-clock** hour (``localtime.local_hour``) equals ``hour_local``. The hour check is
  deliberately the real clock, not the night-owl streak day: "send at 21:00" means 21:00. Night owl only
  matters for *which day* is meant (``localtime.local_date``), which decides "already practised today"
  and "already mailed today";
* nothing counted as practice on that streak day (a streak-qualifying day, or any logged attempt);
* ``last_sent_on`` is not that streak day yet.

DST: the hour is compared in the profile's own zone, so it follows its clock changes. In the spring gap
(the chosen hour does not exist that day, e.g. 02:00) the mail goes out in the next hour instead of being
skipped; in the autumn overlap the hour happens twice and ``last_sent_on`` keeps it to one mail.

Sending claims the day with a conditional UPDATE *before* delivery (two overlapping runs cannot both
mail), and hands the claim back if delivery fails so the next run retries.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import EmailMultiAlternatives
from django.db.models import Q
from django.template.loader import render_to_string
from django.utils import timezone

from ..localtime import local_date, local_hour, local_now, timezone_confirmed, tzinfo_for
from ..models import (
    DailyActivity,
    FeatureFlag,
    Profile,
    ReminderPreference,
    active_profile_q,
)
from ..practice import flags
from ..progress import streaks
from . import tokens

log = logging.getLogger(__name__)

FLAG = "reminders"
DEFAULT_HOUR = 18
SUBJECT = "Time for your Twister practice"
SUBJECT_STREAK = "Keep your Twister streak going"


def get(profile: Profile) -> dict:
    """The body of ``GET /me/reminders/``. A profile with no row is simply "off"."""
    row = ReminderPreference.objects.filter(profile=profile).first()
    return {
        "enabled": row.enabled if row else False,
        "hour_local": row.hour_local if row else DEFAULT_HOUR,
        "timezone": profile.timezone,
        "timezone_confirmed": timezone_confirmed(profile),
    }


def update(profile: Profile, enabled: bool, hour_local: int) -> dict:
    ReminderPreference.objects.update_or_create(
        profile=profile, defaults={"enabled": enabled, "hour_local": hour_local}
    )
    return get(profile)


def unsubscribe(profile_id) -> bool:
    """Switch reminders off. Idempotent; ``True`` when a row was actually switched."""
    return bool(
        ReminderPreference.objects.filter(profile_id=profile_id, enabled=True).update(enabled=False)
    )


def hour_exists(profile: Profile, day: dt.date, hour: int) -> bool:
    """False when ``hour`` is skipped on ``day`` by a spring-forward change in the profile's zone."""
    tz = tzinfo_for(profile)
    wall = dt.datetime.combine(day, dt.time(hour), tzinfo=tz)
    return wall.astimezone(dt.UTC).astimezone(tz).hour == hour


def is_send_hour(profile: Profile, hour_local: int, now: dt.datetime) -> bool:
    """Whether this run is the one that should mail ``profile`` for ``hour_local``."""
    current = local_hour(profile, now)
    if current == hour_local:
        return True
    # Spring gap: the chosen hour never happens today, so the first hour that does stands in for it.
    wall_day = local_now(profile, now).date()
    return current == (hour_local + 1) % 24 and not hour_exists(profile, wall_day, hour_local)


def practised(profile: Profile, day: dt.date) -> bool:
    return (
        streaks.practised_today(profile, day)
        or DailyActivity.objects.filter(profile=profile, local_date=day)
        .filter(Q(attempts__gt=0) | Q(qualifies_streak=True))
        .exists()
    )


def require_urls() -> None:
    """One-click unsubscribe needs absolute URLs on both sides; refuse to mail without them."""
    missing = [n for n in ("API_PUBLIC_URL", "WEB_BASE_URL") if not getattr(settings, n)]
    if missing:
        raise ImproperlyConfigured(f"Reminders need {' and '.join(missing)} to be set.")


def build_message(profile: Profile, day: dt.date) -> EmailMultiAlternatives:
    token = tokens.make_token(profile.pk)
    streak = streaks.effective_streak(profile, day)
    context = {
        "name": profile.display_name,
        "streak": streak,
        "practice_url": f"{settings.WEB_BASE_URL}/",
        "settings_url": f"{settings.WEB_BASE_URL}/account",
        "unsubscribe_url": tokens.web_url(token),
    }
    message = EmailMultiAlternatives(
        SUBJECT_STREAK if streak else SUBJECT,
        render_to_string("reminders/practice_reminder.txt", context),
        settings.DEFAULT_FROM_EMAIL,
        [profile.email],
        headers={
            "List-Unsubscribe": f"<{tokens.api_url(token)}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
    )
    message.attach_alternative(
        render_to_string("reminders/practice_reminder.html", context), "text/html"
    )
    return message


@dataclass(frozen=True)
class Report:
    considered: int = 0
    sent: int = 0
    failed: int = 0
    flag_off: bool = False


def _claim(profile: Profile, day: dt.date) -> bool:
    """Take today's slot; also re-checks the preference and the account under the UPDATE itself."""
    return bool(
        ReminderPreference.objects.filter(
            Q(last_sent_on__isnull=True) | ~Q(last_sent_on=day),
            profile=profile,
            enabled=True,
        )
        .filter(active_profile_q("profile__"))
        .update(last_sent_on=day)
    )


def _release(profile: Profile, day: dt.date, previous: dt.date | None) -> None:
    ReminderPreference.objects.filter(profile=profile, last_sent_on=day).update(
        last_sent_on=previous
    )


def send_due(now: dt.datetime | None = None) -> Report:
    """Send every reminder that is due at ``now``; returns what happened."""
    now = now or timezone.now()
    flag = FeatureFlag.objects.filter(code=FLAG).first()
    if flag is None or not flag.enabled:
        return Report(flag_off=True)  # kill switch: not even a query on preferences
    require_urls()

    rows = (
        ReminderPreference.objects.filter(enabled=True, profile__email__gt="")
        .filter(active_profile_q("profile__"))
        .select_related("profile")
        .iterator(chunk_size=500)
    )
    considered = sent = failed = 0
    for row in rows:
        profile = row.profile
        if not timezone_confirmed(profile) or not flags.is_on(flag, profile):
            continue
        if not is_send_hour(profile, row.hour_local, now):
            continue
        day = local_date(profile, now)
        if row.last_sent_on == day or practised(profile, day):
            continue
        considered += 1
        if not _claim(profile, day):
            continue
        try:
            build_message(profile, day).send()
        except (
            Exception
        ):  # any delivery failure releases the claim; one bad address must not stop the run
            _release(profile, day, row.last_sent_on)
            failed += 1
            log.warning("reminder.send_failed profile=%s", profile.pk)
            continue
        sent += 1
        log.info("reminder.sent profile=%s", profile.pk)
    return Report(considered=considered, sent=sent, failed=failed)
