"""Leaderboards: public names (D18), the weekly board and the per-twister board.

Privacy first: a board never shows `display_name`, an e-mail or an OAuth name. A row carries the
opt-in `public_name` or a stable `Player NNNN`. `hide_from_boards` and under-13 profiles are excluded
both when the weekly table is built *and* when it is read, so an opt-out takes effect immediately
instead of at the next hourly rebuild.
"""

import datetime as dt
import hashlib

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from rest_framework.exceptions import NotFound

from .. import errors
from ..models import (
    AgeBand,
    LeaderboardEntry,
    Profile,
    Twister,
    active_profile_q,
)
from ..practice import flags
from ..speak.queries import leaderboard_attempts
from . import daily

WEEKLY_BOARDS_FLAG = "weekly_boards"
DAYS_PER_WEEK = 7
PLAYER_NUMBER_DIGITS = 4
MINORS_MESSAGE = "Leaderboards are for people aged 13 or older."


# --- names & weeks ---------------------------------------------------------------------------------


def board_name_for(profile_id, public_name: str) -> str:
    """The only name a board may show. The number is derived from the profile id, so it is stable and
    reveals nothing about the account."""
    if public_name:
        return public_name
    digest = int(hashlib.sha256(str(profile_id).encode()).hexdigest()[:8], 16)
    return f"Player {digest % 10**PLAYER_NUMBER_DIGITS:0{PLAYER_NUMBER_DIGITS}d}"


def board_name(profile: Profile) -> str:
    return board_name_for(profile.pk, profile.public_name)


def week_start(moment: dt.datetime | dt.date) -> dt.date:
    """Monday (UTC) of the week containing ``moment``."""
    day = moment.astimezone(dt.UTC).date() if isinstance(moment, dt.datetime) else moment
    return day - dt.timedelta(days=day.weekday())


def _week_bounds(start: dt.date) -> tuple[dt.datetime, dt.datetime]:
    begin = dt.datetime.combine(start, dt.time.min, tzinfo=dt.UTC)
    return begin, begin + dt.timedelta(days=DAYS_PER_WEEK)


# --- eligibility & rebuild -------------------------------------------------------------------------


def _public(rows):
    """Attempts or board entries of people who appear on boards at all (both have a `profile`)."""
    return rows.filter(active_profile_q("profile__"), profile__hide_from_boards=False).exclude(
        profile__age_band=AgeBand.UNDER13
    )


def eligible_attempts(start: dt.date):
    """Attempts that may rank in the week starting ``start``: board-eligible tests (flagged and, when
    required, unverified ones are already out) of people who appear on boards."""
    begin, end = _week_bounds(start)
    return _public(leaderboard_attempts()).filter(created_at__gte=begin, created_at__lt=end)


def rebuild_week(start: dt.date, twister: Twister) -> int:
    """Replace the stored board of one (week, twister): one row per profile with their best eligible
    score, ranked by score, then earliest achieved, then profile id. Idempotent; returns the row count."""
    rows = (
        eligible_attempts(start)
        .filter(twister=twister)
        .order_by("profile_id", "-score", "created_at", "id")
        .values_list("profile_id", "score", "created_at", "id")
    )
    best: dict = {}
    for profile_id, score, achieved_at, attempt_id in rows.iterator():
        best.setdefault(
            profile_id, (score, achieved_at, attempt_id)
        )  # first row = the profile's best
    ranked = sorted(best.items(), key=lambda item: (-item[1][0], item[1][1], item[0]))
    entries = [
        LeaderboardEntry(
            week_start=start,
            twister=twister,
            profile_id=profile_id,
            best_score=score,
            best_attempt_id=attempt_id,
            achieved_at=achieved_at,
            rank=rank,
        )
        for rank, (profile_id, (score, achieved_at, attempt_id)) in enumerate(ranked, start=1)
    ]
    with transaction.atomic():
        LeaderboardEntry.objects.filter(week_start=start, twister=twister).delete()
        LeaderboardEntry.objects.bulk_create(entries)
    return len(entries)


def recent_weeks(now: dt.datetime) -> list[dt.date]:
    """The weeks the hourly job keeps fresh: this one and the one before (late-arriving offline attempts)."""
    current = week_start(now)
    return [current, current - dt.timedelta(days=DAYS_PER_WEEK)]


def featured_twisters(start: dt.date, today: dt.date) -> list[Twister]:
    """Twisters that were the daily twister on any day of the week so far. Every day is materialised
    first, so a day nobody opened still gets its (deterministic) row."""
    last = min(start + dt.timedelta(days=DAYS_PER_WEEK - 1), today)
    rows = [
        daily.find_or_create(start + dt.timedelta(days=i)) for i in range((last - start).days + 1)
    ]
    ids = {row.twister_id for row in rows if row is not None}
    return list(Twister.objects.public().filter(pk__in=ids).order_by("id"))


def rebuild_recent(now: dt.datetime) -> dict[str, int]:
    """One transaction per (week, twister). Returns {'boards': n, 'entries': n}."""
    today = now.astimezone(dt.UTC).date()
    boards = entries = 0
    for start in recent_weeks(now):
        for twister in featured_twisters(start, today):
            entries += rebuild_week(start, twister)
            boards += 1
    return {"boards": boards, "entries": entries}


# --- reads -----------------------------------------------------------------------------------------


def require_weekly_access(viewer: Profile | None) -> None:
    if not flags.enabled(WEEKLY_BOARDS_FLAG, viewer):
        raise errors.feature_disabled("Weekly leaderboards are not available right now.")
    if viewer is not None and viewer.age_band == AgeBand.UNDER13:
        raise errors.minor_not_allowed(MINORS_MESSAGE)


def resolve_twister(slug: str | None, today: dt.date) -> Twister:
    if slug is None:
        return daily.daily_twister(today).twister
    try:
        return Twister.objects.public().get(slug=slug)
    except Twister.DoesNotExist:
        raise NotFound("No such twister.") from None


def weekly_board(viewer: Profile | None, twister: Twister, now: dt.datetime) -> dict:
    """The stored weekly table for ``twister``. Never aggregates attempts live."""
    start = week_start(now)
    stored = LeaderboardEntry.objects.filter(week_start=start, twister=twister)
    visible = _public(stored)
    top = list(visible.select_related("profile").order_by("rank")[: settings.LEADERBOARD_TOP_N])
    hidden = viewer is not None and viewer.hide_from_boards
    mine = None if viewer is None or hidden else stored.filter(profile=viewer).first()
    return {
        "week_start": start.isoformat(),
        "week_end": (start + dt.timedelta(days=DAYS_PER_WEEK - 1)).isoformat(),
        "twister": {"slug": twister.slug, "text": twister.text},
        "top": [
            {
                "rank": e.rank,
                "name": board_name(e.profile),
                "emoji": e.profile.avatar_emoji,
                "score": e.best_score,
                "achieved_at": e.achieved_at,
                "is_me": viewer is not None and e.profile_id == viewer.pk,
            }
            for e in top
        ],
        "me": {"rank": mine.rank, "score": mine.best_score} if mine else None,
        "hidden": hidden,
        "updated_at": stored.aggregate(at=Max("built_at"))["at"],
    }


def twister_board(twister: Twister) -> list[dict]:
    """`GET /twisters/{slug}/leaderboard/`: best eligible test per person over all time."""
    rows = (
        _public(leaderboard_attempts().filter(twister=twister))
        .values("profile_id", "profile__public_name", "profile__avatar_emoji")
        .annotate(best=Max("score"))
        .order_by("-best", "profile_id")[: settings.LEADERBOARD_TOP_N]
    )
    return [
        {
            "user": board_name_for(r["profile_id"], r["profile__public_name"]),
            "emoji": r["profile__avatar_emoji"],
            "score": r["best"],
        }
        for r in rows
    ]
