"""Round 2 migration 0016 on real data: existing twisters become public and unowned, and it reverses cleanly."""

import uuid

import pytest
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor

BEFORE = ("twisters", "0015_round1_seeds")
AFTER = ("twisters", "0016_round2_generate_schema")

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
def at_0015():
    old = migrate(BEFORE)
    twister = old.get_model("twisters", "Twister").objects.create(
        slug="legacy-one", text="Six slick snakes slid slowly by the sea.", is_published=True
    )
    profile = old.get_model("twisters", "Profile").objects.create(id=uuid.uuid4(), plan_id="free")
    yield old, twister, profile
    migrate(*latest())


def test_existing_twisters_become_public_and_unowned(at_0015):
    _, twister, _ = at_0015
    new = migrate(AFTER)
    kept = new.get_model("twisters", "Twister").objects.get(pk=twister.pk)
    assert (kept.visibility, kept.owner_id, kept.topic, kept.is_published) == (
        "public",
        None,
        "",
        True,
    )


def test_the_new_constraint_is_enforced_at_0016(at_0015):
    _, _, profile = at_0015
    new = migrate(AFTER)
    Twister = new.get_model("twisters", "Twister")
    with pytest.raises(IntegrityError), transaction.atomic():
        Twister.objects.create(slug="bad", text="x", visibility="private", is_published=False)
    with pytest.raises(IntegrityError), transaction.atomic():
        Twister.objects.create(
            slug="bad2", text="x", visibility="private", owner_id=profile.pk, is_published=True
        )
    Twister.objects.create(
        slug="ok", text="x", visibility="private", owner_id=profile.pk, is_published=False
    )


def test_backward_keeps_every_row_and_private_ones_stay_unpublished(at_0015):
    old, twister, profile = at_0015
    new = migrate(AFTER)
    new.get_model("twisters", "Twister").objects.create(
        slug="mine", text="x", visibility="private", owner_id=profile.pk, is_published=False
    )
    new.get_model("twisters", "GenerationUsage").objects.create(
        profile_id=profile.pk, day="2026-10-01", count=2
    )
    back = migrate(BEFORE)
    assert back.get_model("twisters", "Twister").objects.filter(pk=twister.pk).exists()
    assert back.get_model("twisters", "Profile").objects.filter(pk=profile.pk).exists()
    mine = back.get_model("twisters", "Twister").objects.get(slug="mine")
    assert mine.is_published is False  # still hidden from every legacy `is_published` filter
    assert "visibility" not in {f.name for f in back.get_model("twisters", "Twister")._meta.fields}
