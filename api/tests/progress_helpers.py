"""Shared builders for the progress (06d) API tests. Rows are created straight through the ORM: the
scoring pipeline is covered elsewhere, and these tests need exact scores, kinds and timestamps."""

import datetime as dt
import uuid

from django.utils import timezone as django_timezone

from twisters.models import (
    Attempt,
    AttemptKind,
    Profile,
    Twister,
    UserTwisterStats,
)

API = "/api/v1"
UTC = dt.UTC


def at(year=2026, month=9, day=1, hour=12, minute=0) -> dt.datetime:
    return dt.datetime(year, month, day, hour, minute, tzinfo=UTC)


def new_profile(**over) -> Profile:
    over.setdefault("id", uuid.uuid4())
    return Profile.objects.create(**over)


def twister(slug: str | None = None, **filters) -> Twister:
    """A seeded twister by slug, or the first published one matching ``filters`` (stable order)."""
    qs = Twister.objects.filter(is_published=True, **filters).order_by("id")
    return qs.get(slug=slug) if slug else qs.first()


def make_attempt(
    profile: Profile,
    tw: Twister | None = None,
    *,
    score: int = 80,
    kind: str = AttemptKind.TEST,
    when: dt.datetime | None = None,
    accuracy: float = 0.8,
    wpm: float = 100.0,
    duration_ms: int = 4000,
    **over,
) -> Attempt:
    attempt = Attempt.objects.create(
        profile=profile,
        twister=tw or twister(),
        kind=kind,
        score=score,
        accuracy=accuracy,
        wpm=wpm,
        duration_ms=duration_ms,
        **over,
    )
    if when is not None:  # auto_now_add ignores create() kwargs
        Attempt.objects.filter(pk=attempt.pk).update(created_at=when)
        attempt.created_at = when
    return attempt


def make_stats(profile: Profile, tw: Twister, *, mastered=False, **over) -> UserTwisterStats:
    over.setdefault("attempts_count", 1)
    if mastered:
        over.setdefault("mastered_at", django_timezone.now())
        over.setdefault("best_score", 95)
    return UserTwisterStats.objects.create(profile=profile, twister=tw, **over)


def master(profile: Profile, twisters: list[Twister]) -> None:
    for tw in twisters:
        make_stats(profile, tw, mastered=True)


def error_code(response) -> str:
    return response.data["error"]["code"]


def freeze_time(monkeypatch, moment: dt.datetime) -> None:
    """Pin `timezone.now()` everywhere (views, services, model defaults) to ``moment``."""
    monkeypatch.setattr(django_timezone, "now", lambda: moment)
