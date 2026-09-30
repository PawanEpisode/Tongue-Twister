"""T-3 day expiry reminder e-mails (transactional: always sent, no marketing opt-in involved).

One e-mail per user per run covering every take that expires within `EXPIRY_REMINDER_DAYS`. Idempotent
through `Recording.reminder_sent_at`: the rows are claimed with a conditional UPDATE *before* sending, so
two overlapping runs cannot both mail the same take, and the claim is handed back if delivery fails so
the next hourly run retries. The message links to `/recordings`; it carries no signed URLs or tokens.
"""

from __future__ import annotations

import datetime as dt
import logging
from collections import defaultdict

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils import timezone

from ..models import Profile, Recording, RecordingStatus

log = logging.getLogger(__name__)

SUBJECT_ONE = "Your Twister recording expires soon"
SUBJECT_MANY = "Your Twister recordings expire soon"


def send_expiry_reminder(profile: Profile, takes: list[Recording]) -> None:
    """Render and send one reminder covering `takes` (raises on delivery failure)."""
    context = {
        "name": profile.display_name,
        "takes": takes,
        "days": settings.EXPIRY_REMINDER_DAYS,
        "library_url": f"{settings.WEB_BASE_URL}/recordings",
    }
    message = EmailMultiAlternatives(
        SUBJECT_ONE if len(takes) == 1 else SUBJECT_MANY,
        render_to_string("media/expiry_reminder.txt", context),
        settings.DEFAULT_FROM_EMAIL,
        [profile.email],
    )
    message.attach_alternative(render_to_string("media/expiry_reminder.html", context), "text/html")
    message.send()


def remind_expiring(now: dt.datetime | None = None) -> int:
    """Send the reminders that are due; returns how many recordings were covered."""
    now = now or timezone.now()
    horizon = now + dt.timedelta(days=settings.EXPIRY_REMINDER_DAYS)
    due = (
        Recording.objects.filter(
            deleted_at__isnull=True,
            status=RecordingStatus.READY,
            expires_at__lte=horizon,
            expires_at__gt=now,
            reminder_sent_at__isnull=True,
            profile__email__gt="",
        )
        .select_related("profile", "twister")
        .order_by("expires_at")
    )
    by_profile: dict = defaultdict(list)
    for recording in due:
        by_profile[recording.profile_id].append(recording)

    reminded = 0
    for takes in by_profile.values():
        ids = [r.pk for r in takes]
        claimed = Recording.objects.filter(pk__in=ids, reminder_sent_at__isnull=True).update(
            reminder_sent_at=now
        )
        if not claimed:
            continue  # another run took them
        try:
            send_expiry_reminder(takes[0].profile, takes)
        except Exception:  # any delivery failure must release the claim, not stop the job
            Recording.objects.filter(pk__in=ids, reminder_sent_at=now).update(reminder_sent_at=None)
            log.warning("recording.expiry_reminder_failed profile=%s", takes[0].profile_id)
            continue
        reminded += len(ids)
        log.info(
            "recording.expiry_reminder_sent profile=%s count=%s", takes[0].profile_id, len(ids)
        )
    return reminded
