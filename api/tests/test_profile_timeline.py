"""Daily goal, the profile timeline and the attempts CSV."""

import csv
import io

import pytest

from twisters.models import ProfileEvent, ProfileEventKind, UserPreference
from twisters.progress import timeline

from .media_helpers import API
from .speak_helpers import submit

pytestmark = pytest.mark.django_db


def summary(client):
    return client.get(f"{API}/me/summary/").data


def timeline_rows(client):
    return client.get(f"{API}/me/timeline/").data


# --- daily goal -----------------------------------------------------------------------------------


def test_no_goal_by_default(user):
    client, _ = user
    assert summary(client)["daily_goal"] == {"target": 0, "done": 0, "met": False}
    assert client.get(f"{API}/me/preferences/").data["daily_goal_attempts"] == 0


def test_goal_counts_todays_attempts_and_flips_to_met(user):
    client, _ = user
    assert (
        client.patch(
            f"{API}/me/preferences/", {"daily_goal_attempts": 2}, format="json"
        ).status_code
        == 200
    )
    submit(client)
    assert summary(client)["daily_goal"] == {"target": 2, "done": 1, "met": False}
    submit(client)
    assert summary(client)["daily_goal"] == {"target": 2, "done": 2, "met": True}


@pytest.mark.parametrize("bad", [-1, 51, "lots"])
def test_goal_is_bounded(user, bad):
    client, profile = user
    r = client.patch(f"{API}/me/preferences/", {"daily_goal_attempts": bad}, format="json")
    assert r.status_code == 400
    assert not UserPreference.objects.filter(profile=profile, daily_goal_attempts__gt=0).exists()


# --- timeline -------------------------------------------------------------------------------------


def test_empty_timeline_is_an_empty_page(user):
    client, _ = user
    body = timeline_rows(client)
    assert body["count"] == 0 and body["results"] == []


def test_timeline_needs_sign_in(anon):
    assert anon.get(f"{API}/me/timeline/").status_code in (401, 403)


def test_a_first_attempt_leaves_moments_newest_first(user):
    client, _ = user
    assert submit(client).status_code in (200, 201)
    body = timeline_rows(client)
    kinds = {row["kind"] for row in body["results"]}
    assert ProfileEventKind.PERSONAL_BEST in kinds
    dates = [row["created_at"] for row in body["results"]]
    assert dates == sorted(dates, reverse=True)


def test_recording_is_idempotent(user):
    _, profile = user
    for _ in range(3):
        timeline.record(profile, ProfileEventKind.LEVEL_UP, "level:2", {"level": 2})
    assert ProfileEvent.objects.filter(profile=profile, ref="level:2").count() == 1


def test_a_failure_in_recording_never_raises(user, monkeypatch):
    _, profile = user

    def boom(*a, **k):
        raise RuntimeError("db down")

    monkeypatch.setattr(ProfileEvent.objects, "bulk_create", boom)
    timeline.record(profile, ProfileEventKind.LEVEL_UP, "level:9")  # must not raise


def test_streak_milestones_only_on_milestone_days(user, settings):
    _, profile = user
    settings.STREAK_MILESTONES = (3, 7)
    timeline.record_streak_milestone(profile, 2)
    timeline.record_streak_milestone(profile, 3)
    assert list(ProfileEvent.objects.filter(profile=profile).values_list("ref", flat=True)) == [
        "streak:3"
    ]


def test_timelines_are_private(user, anon):
    client, profile = user
    timeline.record(profile, ProfileEventKind.LEVEL_UP, "level:2")
    other = timeline_rows(anon) if anon.get(f"{API}/me/timeline/").status_code == 200 else None
    assert other is None
    assert timeline_rows(client)["count"] == 1


# --- CSV ------------------------------------------------------------------------------------------


def test_csv_has_a_header_and_one_row_per_attempt(user):
    client, _ = user
    submit(client)
    submit(client)
    r = client.get(f"{API}/me/export/attempts.csv")
    assert r.status_code == 200
    assert r["Content-Type"].startswith("text/csv")
    assert "attachment" in r["Content-Disposition"] and r["Cache-Control"] == "private, no-store"
    text = b"".join(r.streaming_content).decode("utf-8-sig")
    rows = list(csv.DictReader(io.StringIO(text)))
    assert len(rows) == 2
    assert set(rows[0]) >= {"date", "twister", "score", "wpm", "transcript"}


def test_csv_neutralises_spreadsheet_formulas():
    from twisters.account.export import _csv_cell

    assert _csv_cell("=HYPERLINK(1)") == "'=HYPERLINK(1)"
    assert _csv_cell("+1") == "'+1"
    assert _csv_cell("hello") == "hello"
    assert _csv_cell(None) == "" and _csv_cell(True) == "true"


def test_csv_needs_sign_in(anon):
    assert anon.get(f"{API}/me/export/attempts.csv").status_code in (401, 403)


def test_json_export_carries_the_timeline(user):
    client, profile = user
    timeline.record(profile, ProfileEventKind.LEVEL_UP, "level:2", {"level": 2})
    body = b"".join(client.get(f"{API}/me/export/").streaming_content).decode()
    assert '"timeline":[' in body and "level:2" in body


def test_backfill_seeds_old_accounts_once(user):
    from django.core.management import call_command

    from twisters.models import Achievement, UserAchievement

    _, profile = user
    badge = Achievement.objects.filter(active=True).first()
    UserAchievement.objects.get_or_create(profile=profile, achievement=badge)
    call_command("backfill_profile_events")
    call_command("backfill_profile_events")
    refs = list(ProfileEvent.objects.filter(profile=profile).values_list("ref", flat=True))
    assert refs.count(f"ach:{badge.code}") == 1
