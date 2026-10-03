"""0026 backfills the canonical inbox of every existing account, and reverses cleanly."""

import uuid

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

BEFORE = ("twisters", "0025_profile_events_daily_goal")


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


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_existing_profiles_are_backfilled():
    old = migrate(BEFORE)
    try:
        Profile = old.get_model("twisters", "Profile")
        ids = {
            "J.Doe+x@googlemail.com": uuid.uuid4(),
            "plain@example.org": uuid.uuid4(),
            "": uuid.uuid4(),
        }
        for email, pk in ids.items():
            Profile.objects.create(id=pk, email=email)
        new = migrate(*latest())
        Profile = new.get_model("twisters", "Profile")
        got = {p.email: p.canonical_email for p in Profile.objects.all()}
        assert got == {
            "J.Doe+x@googlemail.com": "jdoe@gmail.com",
            "plain@example.org": "plain@example.org",
            "": "",
        }
    finally:
        migrate(*latest())
