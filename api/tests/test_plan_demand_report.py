"""Paid-plan evidence: cap hits are recorded by the 402 handler and summarised by `plan_demand_report`."""

import datetime as dt
import json
import uuid

import pytest
from django.core.management import call_command
from django.utils import timezone

from twisters.management.commands.plan_demand_report import build, render
from twisters.media import quota
from twisters.models import Attempt, Plan, Profile, QuotaHit, Recording, Twister

from .media_helpers import API, create_recording, saved_recording

NOW = timezone.now()


def days_ago(n: float) -> dt.datetime:
    return NOW - dt.timedelta(days=n)


def person(
    *, first_seen_days_ago: float | None = None, last_seen_days_ago: float | None = None
) -> Profile:
    """A user with an attempt at the given moments (None = never active)."""
    profile = Profile.objects.create(email=f"{uuid.uuid4().hex[:8]}@t.co")
    twister = Twister.objects.first()
    for ago in {a for a in (first_seen_days_ago, last_seen_days_ago) if a is not None}:
        attempt = Attempt.objects.create(
            profile=profile,
            twister=twister,
            kind="test",
            transcript="x",
            accuracy=70,
            speed_score=70,
            fluency_score=70,
            completeness=70,
            duration_ms=4000,
            wpm=100,
            score=70,
        )
        Attempt.objects.filter(pk=attempt.pk).update(created_at=days_ago(ago))
    return profile


def hit(profile: Profile, limit: str, ago: float = 1) -> None:
    row = QuotaHit.objects.create(profile=profile, limit=limit, plan_code="free")
    QuotaHit.objects.filter(pk=row.pk).update(created_at=days_ago(ago))


@pytest.fixture
def seeded_twisters(seeded):
    return seeded


# --- the handler records hits ------------------------------------------------------------------------


def cap_recordings_at_one() -> None:
    Plan.objects.filter(code="free").update(limits={"recordings_max": 1})


def test_a_402_records_one_hit_per_user_limit_and_ten_minutes(cloud_user, storage, settings):
    client, profile = cloud_user
    cap_recordings_at_one()
    saved_recording(client, storage)
    for _ in range(3):
        r = create_recording(client)
        assert r.status_code == 402 and r.data["error"]["details"]["limit"] == "recordings"
    rows = QuotaHit.objects.filter(profile=profile)
    assert rows.count() == 1 and rows[0].limit == "recordings" and rows[0].plan_code == "free"


def test_a_later_window_records_again(cloud_user, storage, settings):
    client, profile = cloud_user
    cap_recordings_at_one()
    saved_recording(client, storage)
    create_recording(client)
    QuotaHit.objects.update(created_at=days_ago(1))
    create_recording(client)
    assert QuotaHit.objects.filter(profile=profile).count() == 2


def test_other_errors_record_nothing(user):
    client, _ = user
    assert client.get(f"{API}/recordings/{uuid.uuid4()}/").status_code == 404
    assert not QuotaHit.objects.exists()


def test_a_recording_failure_inside_the_handler_never_changes_the_402(
    cloud_user, storage, settings, monkeypatch
):
    client, _ = cloud_user
    cap_recordings_at_one()
    saved_recording(client, storage)
    monkeypatch.setattr(
        QuotaHit.objects, "create", lambda **_: (_ for _ in ()).throw(RuntimeError("db down"))
    )
    assert create_recording(client).status_code == 402


def test_hits_are_pruned_after_the_retention_window(user, settings):
    _, profile = user
    hit(profile, "recordings", ago=settings.QUOTA_HIT_RETENTION_DAYS + 1)
    hit(profile, "recordings", ago=1)
    assert quota.prune_hits(NOW) == 1 and QuotaHit.objects.count() == 1


# --- the report ----------------------------------------------------------------------------------------


def test_an_empty_database_reports_zeroes_and_no_rates(seeded):
    report = build(NOW)
    assert report["active_users"] == 0 and report["share_hitting_any_cap"] is None
    assert report["enough_evidence"] is False
    assert "Not enough evidence" in render(report)


def test_it_counts_hits_users_and_shares_by_limit(seeded):
    a, b, c, d = (person(first_seen_days_ago=30, last_seen_days_ago=2) for _ in range(4))
    hit(a, "recordings"), hit(a, "recordings", ago=3), hit(b, "recordings"), hit(b, "storage_bytes")
    report = build(NOW, min_users=2)
    assert report["active_users"] == 4 and report["users_hitting_any_cap"] == 2
    assert report["share_hitting_any_cap"] == 0.5
    rec = report["by_limit"]["recordings"]
    assert (rec["hits"], rec["users"], rec["share_of_active"]) == (3, 2, 0.5)
    assert report["by_limit"]["storage_bytes"]["users"] == 1
    assert report["by_limit"]["recording_ms"]["hits"] == 0
    assert report["enough_evidence"] is True
    assert {c.pk, d.pk}  # the other two never hit anything


def test_hits_outside_the_window_or_by_inactive_people_do_not_count(seeded):
    a = person(first_seen_days_ago=10, last_seen_days_ago=1)
    ghost = Profile.objects.create(email="g@t.co")  # never active
    old = person(first_seen_days_ago=200, last_seen_days_ago=190)
    hit(a, "recordings", ago=5), hit(ghost, "recordings"), hit(old, "recordings", ago=100)
    report = build(NOW, days=60)
    assert report["active_users"] == 1
    assert report["by_limit"]["recordings"]["users"] == 2  # a and ghost are in the window ...
    assert (
        report["by_limit"]["recordings"]["share_of_active"] == 1.0
    )  # ... but only active ones form the share


def test_accounts_pending_deletion_are_excluded(seeded):
    gone = person(first_seen_days_ago=20, last_seen_days_ago=1)
    Profile.objects.filter(pk=gone.pk).update(
        deletion_requested_at=days_ago(1), deletion_scheduled_for=days_ago(-29)
    )
    hit(gone, "recordings")
    report = build(NOW)
    assert report["active_users"] == 0 and report["by_limit"]["recordings"]["users"] == 0


def test_retention_compares_capped_and_uncapped_people(seeded):
    stayed = person(first_seen_days_ago=40, last_seen_days_ago=2)
    left = person(first_seen_days_ago=40, last_seen_days_ago=30)
    fine = person(first_seen_days_ago=40, last_seen_days_ago=1)
    brand_new = person(first_seen_days_ago=3, last_seen_days_ago=1)  # too new to judge retention
    hit(stayed, "recordings"), hit(left, "recordings")
    r = build(NOW)["retention"]
    assert r["cohort"] == 3  # brand_new is not in the cohort
    assert r["capped"] == {"users": 2, "retained": 1, "rate": 0.5}
    assert r["not_capped"] == {"users": 1, "retained": 1, "rate": 1.0}
    assert {fine.pk, brand_new.pk}


def test_the_command_prints_text_and_json(seeded, capsys):
    person(first_seen_days_ago=20, last_seen_days_ago=1)
    call_command("plan_demand_report")
    assert "Plan demand, last 60 days" in capsys.readouterr().out
    call_command("plan_demand_report", "--json", "--days", "30")
    data = json.loads(capsys.readouterr().out)
    assert data["window_days"] == 30 and data["active_users"] == 1


def test_a_recording_counts_as_activity_and_a_saver(cloud_user, storage):
    client, profile = cloud_user
    saved_recording(client, storage)
    report = build(timezone.now())
    assert report["active_users"] == 1 and report["cloud_users"] == 1
    assert Recording.objects.filter(profile=profile).exists()
