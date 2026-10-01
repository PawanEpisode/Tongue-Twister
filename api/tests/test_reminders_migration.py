"""Round 2 migration 0017 (reminder preferences): adds one table, touches no data, reverses cleanly."""

import uuid

import pytest
from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor

BEFORE = ("twisters", "0016_round2_generate_schema")
AFTER = ("twisters", "0017_round2_reminders_schema")

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
def at_0016():
    old = migrate(BEFORE)
    profile = old.get_model("twisters", "Profile").objects.create(id=uuid.uuid4(), plan_id="free")
    yield old, profile
    migrate(*latest())


def test_forward_keeps_profiles_and_allows_preferences_with_a_range_check(at_0016):
    _, profile = at_0016
    new = migrate(AFTER)
    Reminder = new.get_model("twisters", "ReminderPreference")
    assert new.get_model("twisters", "Profile").objects.filter(pk=profile.pk).exists()
    row = Reminder.objects.create(profile_id=profile.pk, enabled=True, hour_local=23)
    assert (row.enabled, row.hour_local, row.last_sent_on) == (True, 23, None)
    Reminder.objects.all().delete()
    with pytest.raises(IntegrityError), transaction.atomic():
        Reminder.objects.create(profile_id=profile.pk, hour_local=24)


def test_it_reverses_cleanly(at_0016):
    _, profile = at_0016
    migrate(AFTER)
    old = migrate(BEFORE)
    assert old.get_model("twisters", "Profile").objects.filter(pk=profile.pk).exists()
    assert "twisters_reminderpreference" not in connection.introspection.table_names()
