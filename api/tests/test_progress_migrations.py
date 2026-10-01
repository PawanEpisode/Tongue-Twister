"""The 06d migrations on real data: 0012 (schema) and 0013 (seeds) go forward and back with rows present."""

import uuid

import pytest
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor

BEFORE = ("twisters", "0011_media_jobs_privacy")
SCHEMA = ("twisters", "0012_progress_schema")
SEEDS = ("twisters", "0013_progress_seeds")

pytestmark = pytest.mark.django_db(transaction=True, serialized_rollback=True)


def migrate(*targets):
    executor = MigrationExecutor(connection)
    executor.migrate(list(targets))
    return executor.loader.project_state(list(targets)).apps


def latest():
    return [
        key
        for key in MigrationExecutor(connection).loader.graph.leaf_nodes()
        if key[0] == "twisters"
    ]


@pytest.fixture
def at_0011():
    """Start from the pre-06d schema with a profile that has history, and always finish on the latest."""
    old = migrate(BEFORE)
    Profile, Twister, Attempt = (
        old.get_model("twisters", n) for n in ("Profile", "Twister", "Attempt")
    )
    profile = Profile.objects.create(
        id=uuid.uuid4(), plan_id="free", xp=420, current_streak=4, display_name="Kept"
    )
    twister = Twister.objects.create(slug="mig-twister", text="a b c")
    attempt = Attempt.objects.create(
        profile=profile, twister=twister, accuracy=1, duration_ms=1000, wpm=100, score=90
    )
    yield old, profile, twister, attempt
    migrate(*latest())


def flags(apps) -> dict[str, bool]:
    return dict(
        apps.get_model("twisters", "FeatureFlag")
        .objects.filter(code__in=["achievements", "weekly_boards"])
        .values_list("code", "enabled")
    )


def test_forward_keeps_data_adds_defaults_and_seeds(at_0011):
    _, profile, twister, attempt = at_0011

    new = migrate(SEEDS)
    Profile = new.get_model("twisters", "Profile")
    kept = Profile.objects.get(pk=profile.pk)
    assert (kept.xp, kept.current_streak, kept.display_name) == (420, 4, "Kept")
    assert (kept.streak_freezes, kept.hide_from_boards) == (0, False)
    assert new.get_model("twisters", "Attempt").objects.filter(pk=attempt.pk).exists()

    Achievement = new.get_model("twisters", "Achievement")
    assert (
        Achievement.objects.count() == 25 and Achievement.objects.filter(active=True).count() == 25
    )
    assert Achievement.objects.get(code="streak_7").criteria == {"type": "streak", "min": 7}
    assert flags(new) == {"achievements": True, "weekly_boards": False}


def test_backward_removes_only_what_06d_added(at_0011):
    _, profile, twister, _ = at_0011
    new = migrate(SEEDS)
    Achievement, UserAchievement = (
        new.get_model("twisters", n) for n in ("Achievement", "UserAchievement")
    )
    UserAchievement.objects.create(profile_id=profile.pk, achievement_id="first_word")
    new.get_model("twisters", "DailyTwister").objects.create(
        day="2026-09-10", twister_id=twister.pk
    )
    new.get_model("twisters", "FeatureFlag").objects.create(code="unrelated", enabled=True)

    mid = migrate(SCHEMA)  # reverse the seeds only
    assert mid.get_model("twisters", "Achievement").objects.count() == 0
    assert mid.get_model("twisters", "UserAchievement").objects.count() == 0
    assert flags(mid) == {}
    assert mid.get_model("twisters", "FeatureFlag").objects.filter(code="unrelated").exists()
    assert (
        mid.get_model("twisters", "DailyTwister").objects.count() == 1
    )  # the schema is still there

    old = migrate(BEFORE)  # and the schema
    kept = old.get_model("twisters", "Profile").objects.get(pk=profile.pk)
    assert (kept.xp, kept.display_name) == (420, "Kept")
    assert not hasattr(kept, "streak_freezes") and not hasattr(kept, "hide_from_boards")
    assert old.get_model("twisters", "Attempt").objects.count() == 1
    assert "twisters_achievement" not in connection.introspection.table_names()


def test_the_round_trip_is_repeatable(at_0011):
    migrate(SEEDS)
    migrate(BEFORE)
    new = migrate(SEEDS)
    assert new.get_model("twisters", "Achievement").objects.count() == 25
    assert flags(new) == {"achievements": True, "weekly_boards": False}


def test_the_schema_constraints_exist_at_0012(at_0011):
    _, profile, twister, _ = at_0011
    new = migrate(SCHEMA)
    Profile, Entry, Daily = (
        new.get_model("twisters", n) for n in ("Profile", "LeaderboardEntry", "DailyTwister")
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        Profile.objects.filter(pk=profile.pk).update(streak_freezes=3)
    Profile.objects.filter(pk=profile.pk).update(streak_freezes=2)
    with pytest.raises(IntegrityError), transaction.atomic():
        Entry.objects.create(
            week_start="2026-09-07",
            twister_id=twister.pk,
            profile_id=profile.pk,
            best_score=101,
            rank=1,
            achieved_at="2026-09-08T00:00:00Z",
        )
    Daily.objects.create(day="2026-09-10", twister_id=twister.pk)
    assert Daily.objects.get(day="2026-09-10").source == "editorial"
    with pytest.raises(IntegrityError), transaction.atomic():
        Daily.objects.filter(day="2026-09-10").update(source="robot")
