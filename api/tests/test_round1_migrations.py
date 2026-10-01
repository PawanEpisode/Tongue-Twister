"""Round 1 migrations on real data: 0014 (schema) and 0015 (seeds) go forward and back with rows present."""

import uuid

import pytest
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor

BEFORE = ("twisters", "0013_progress_seeds")
SCHEMA = ("twisters", "0014_account_night_owl_schema")
SEEDS = ("twisters", "0015_round1_seeds")
NEW_BADGES = {"night_owl", "early_bird"}

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
def at_0013():
    """The pre-round-1 schema with a profile that has history; always finishes on the latest."""
    old = migrate(BEFORE)
    Profile = old.get_model("twisters", "Profile")
    profile = Profile.objects.create(
        id=uuid.uuid4(), plan_id="free", xp=420, current_streak=4, display_name="Kept"
    )
    yield old, profile
    migrate(*latest())


def flag(apps, code):
    return apps.get_model("twisters", "FeatureFlag").objects.filter(code=code).first()


def test_forward_keeps_profiles_and_adds_safe_defaults(at_0013):
    _, profile = at_0013
    new = migrate(SCHEMA)
    kept = new.get_model("twisters", "Profile").objects.get(pk=profile.pk)
    assert (kept.xp, kept.current_streak, kept.display_name) == (420, 4, "Kept")
    assert (kept.night_owl, kept.deletion_requested_at, kept.deletion_scheduled_for) == (
        False,
        None,
        None,
    )


def test_the_deletion_window_constraint_exists_at_0014(at_0013):
    _, profile = at_0013
    Profile = migrate(SCHEMA).get_model("twisters", "Profile")
    with pytest.raises(IntegrityError), transaction.atomic():
        Profile.objects.filter(pk=profile.pk).update(
            deletion_requested_at="2026-09-10T00:00:00Z",
            deletion_scheduled_for="2026-09-09T00:00:00Z",
        )
    with pytest.raises(IntegrityError), transaction.atomic():
        Profile.objects.filter(pk=profile.pk).update(deletion_requested_at="2026-09-10T00:00:00Z")
    Profile.objects.filter(pk=profile.pk).update(
        deletion_requested_at="2026-09-10T00:00:00Z", deletion_scheduled_for="2026-10-10T00:00:00Z"
    )


def test_seeds_add_the_flag_on_and_two_badges(at_0013):
    before = migrate(BEFORE)
    assert flag(before, "score_cards") is None
    assert before.get_model("twisters", "Achievement").objects.count() == 25

    new = migrate(SEEDS)
    assert flag(new, "score_cards").enabled is True
    Achievement = new.get_model("twisters", "Achievement")
    assert Achievement.objects.count() == 27
    owl = Achievement.objects.get(code="night_owl")
    assert (owl.icon, owl.tier, owl.category, owl.xp_reward, owl.active) == (
        "moon",
        "bronze",
        "skill",
        20,
        True,
    )
    assert owl.criteria == {
        "type": "attempt_local_hour",
        "from": 23,
        "to": 3,
        "kinds": ["test", "record"],
    }
    assert Achievement.objects.get(code="early_bird").criteria["from"] == 5


def test_the_seeds_match_the_live_catalogue(at_0013):
    from twisters.progress.catalogue import CATALOGUE

    Achievement = migrate(SEEDS).get_model("twisters", "Achievement")
    for definition in CATALOGUE:
        row = Achievement.objects.get(code=definition.code)
        assert (row.criteria, row.sort_order, row.xp_reward, row.icon) == (
            definition.criteria,
            definition.sort_order,
            definition.xp_reward,
            definition.icon,
        ), definition.code


def test_seeding_twice_does_not_duplicate_anything(at_0013):
    migrate(SEEDS)
    migrate(SCHEMA)  # reverse the seeds...
    again = migrate(SEEDS)  # ...and apply them again
    assert again.get_model("twisters", "Achievement").objects.count() == 27
    assert (
        again.get_model("twisters", "FeatureFlag").objects.filter(code="score_cards").count() == 1
    )


def test_backward_removes_only_round_1(at_0013):
    _, profile = at_0013
    new = migrate(SEEDS)
    UserAchievement = new.get_model("twisters", "UserAchievement")
    UserAchievement.objects.create(profile_id=profile.pk, achievement_id="night_owl")
    UserAchievement.objects.create(profile_id=profile.pk, achievement_id="first_word")
    new.get_model("twisters", "FeatureFlag").objects.create(code="unrelated", enabled=True)

    mid = migrate(SCHEMA)  # seeds reversed, schema kept
    codes = set(mid.get_model("twisters", "Achievement").objects.values_list("code", flat=True))
    assert len(codes) == 25 and not NEW_BADGES & codes
    assert [
        u.achievement_id for u in mid.get_model("twisters", "UserAchievement").objects.all()
    ] == ["first_word"]
    assert flag(mid, "score_cards") is None and flag(mid, "unrelated") is not None

    old = migrate(BEFORE)  # schema reversed
    kept = old.get_model("twisters", "Profile").objects.get(pk=profile.pk)
    assert (kept.xp, kept.display_name) == (420, "Kept")
    assert not hasattr(kept, "night_owl") and not hasattr(kept, "deletion_scheduled_for")


def test_the_round_trip_is_repeatable(at_0013):
    migrate(SEEDS)
    migrate(BEFORE)
    new = migrate(SEEDS)
    assert new.get_model("twisters", "Achievement").objects.count() == 27
    assert flag(new, "score_cards").enabled is True
