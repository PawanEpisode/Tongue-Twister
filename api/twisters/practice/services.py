"""Streak / XP bookkeeping shared by scored attempts and Read-along sessions.

Every function here assumes the caller holds a row lock on the Profile (``select_for_update``)
inside ``transaction.atomic`` so concurrent requests cannot double-count a day.
"""

import datetime as dt
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone

from .. import scoring
from ..models import DailyActivity, PracticeMode, PracticeSession, Profile, SessionStatus


def local_date(profile: Profile, now: dt.datetime | None = None) -> dt.date:
    """'Today' in the profile's timezone (never the request's or the server's)."""
    return (now or timezone.now()).astimezone(ZoneInfo(profile.timezone)).date()


def _today_row(profile: Profile, now: dt.datetime | None) -> DailyActivity:
    return DailyActivity.objects.get_or_create(
        profile=profile, local_date=local_date(profile, now)
    )[0]


def _mark_streak(profile: Profile, day: DailyActivity) -> None:
    """Advance the cached streak the first time a local day qualifies."""
    if day.qualifies_streak:
        return
    day.qualifies_streak = True
    last = profile.last_activity_date
    if last is not None and day.local_date <= last:
        return  # today already counted, or a back-dated (offline) day: it qualifies but the streak doesn't move
    continues = last == day.local_date - dt.timedelta(days=1)
    profile.current_streak = profile.current_streak + 1 if continues else 1
    profile.best_streak = max(profile.best_streak, profile.current_streak)
    profile.last_activity_date = day.local_date


def record_attempt(profile: Profile, xp: int, now: dt.datetime | None = None) -> None:
    day = _today_row(profile, now)
    day.attempts += 1
    day.xp += xp
    _mark_streak(profile, day)
    profile.xp += xp
    day.save()
    profile.save()


def read_along_xp_per_pass(difficulty: int) -> int:
    """Read-along pays a fraction of what a scored (no-bonus, 100-point) attempt would."""
    return round(settings.READ_ALONG_XP_RATIO * scoring.attempt_xp(100, difficulty, accuracy=0.0))


def record_read_along(
    profile: Profile, session: PracticeSession, now: dt.datetime | None = None
) -> int:
    """Credit a finished Read-along session; returns XP awarded (0 when it doesn't qualify)."""
    day = _today_row(profile, now)
    day.active_ms += session.active_ms
    day.read_along_ms += session.active_ms
    day.read_along_passes += session.passes_completed

    xp = 0
    if session.passes_completed >= 1 and session.active_ms >= settings.READ_ALONG_MIN_ACTIVE_MS:
        _mark_streak(profile, day)
        room = max(0, settings.READ_ALONG_XP_DAILY_CAP - day.read_along_xp)
        xp = min(
            room, read_along_xp_per_pass(session.twister.difficulty) * session.passes_completed
        )
        day.read_along_xp += xp
        day.xp += xp
        profile.xp += xp
        profile.save()
    day.save()
    return xp


def apply_session_update(
    session: PracticeSession, data: dict, now: dt.datetime | None = None
) -> int:
    """Apply a heartbeat/finish payload to an *active* session; returns XP awarded on completion.

    ``active_ms`` is monotonic and can never exceed wall-clock time since the session started,
    so a tampered client cannot claim minutes it did not spend.
    """
    now = now or timezone.now()
    wall_ms = (
        int((now - session.started_at).total_seconds() * 1000) + settings.SESSION_CLOCK_SKEW_MS
    )
    if "active_ms" in data:
        data["active_ms"] = min(max(data["active_ms"], session.active_ms), wall_ms)
    for field in ("loops_completed", "passes_completed"):
        if field in data:
            data[field] = max(data[field], getattr(session, field))
    for field, value in data.items():
        setattr(session, field, value)

    finishing = session.status != SessionStatus.ACTIVE
    if finishing:
        session.ended_at = now
    session.save()
    if finishing and session.mode == PracticeMode.READ_ALONG:
        return record_read_along(session.profile, session, now)
    return 0
