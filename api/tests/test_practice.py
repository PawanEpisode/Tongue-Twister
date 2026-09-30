import datetime as dt
import uuid

import pytest
from django.utils import timezone

from twisters.models import DailyActivity, Plan, PracticeSession, Profile

SLUG = "peter-piper"


@pytest.fixture
def user(seeded, auth_client):
    sub = str(uuid.uuid4())
    client = auth_client(sub)
    client.get("/api/v1/me/")  # materialise the profile
    return client, Profile.objects.get(pk=sub)


def start(client, **over):
    body = {"client_session_id": str(uuid.uuid4()), "twister": SLUG, "mode": "read_along", **over}
    return client.post("/api/v1/sessions/", body, format="json")


def age(session_id, ms):
    """Pretend the session started `ms` ago so the wall-clock bound allows that much active time."""
    PracticeSession.objects.filter(pk=session_id).update(started_at=timezone.now() - dt.timedelta(milliseconds=ms))


def finish(client, sid, **over):
    return client.patch(f"/api/v1/sessions/{sid}/", {"status": "completed", "passes_completed": 1, **over}, format="json")


# --- preferences ----------------------------------------------------------------------------

def test_preferences_defaults_and_partial_update(user):
    c, _ = user
    assert c.get("/api/v1/me/preferences/").data["wpm"] is None  # automatic, by difficulty
    r = c.patch("/api/v1/me/preferences/", {"wpm": 150, "display_style": "line"}, format="json")
    assert r.status_code == 200 and (r.data["wpm"], r.data["display_style"]) == (150, "line")
    assert c.get("/api/v1/me/preferences/").data["wpm"] == 150


@pytest.mark.parametrize("field,value", [("wpm", 39), ("wpm", 301), ("threshold_pct", 61), ("font_scale", 2.1),
                                          ("loop_count", 11), ("default_mode", "karaoke"), ("tts_rate", 2),
                                          ("metronome_volume", 1.5), ("metronome_volume", -0.1)])
def test_preferences_reject_out_of_range(user, field, value):
    c, _ = user
    assert c.patch("/api/v1/me/preferences/", {field: value}, format="json").status_code == 400


def test_preferences_extra_merges_and_is_bounded(user):
    c, _ = user
    c.patch("/api/v1/me/preferences/", {"extra": {"a": 1}}, format="json")
    r = c.patch("/api/v1/me/preferences/", {"extra": {"b": 2}}, format="json")
    assert r.data["extra"] == {"a": 1, "b": 2}
    assert c.patch("/api/v1/me/preferences/", {"extra": {"big": "x" * 5000}}, format="json").status_code == 400


def test_preferences_stale_write_conflicts(user):
    c, _ = user
    stale = "Mon, 01 Jan 2001 00:00:00 GMT"
    r = c.patch("/api/v1/me/preferences/", {"wpm": 90}, format="json", headers={"If-Unmodified-Since": stale})
    assert r.status_code == 409
    future = "Fri, 01 Jan 2100 00:00:00 GMT"
    assert c.patch("/api/v1/me/preferences/", {"wpm": 90}, format="json", headers={"If-Unmodified-Since": future}).status_code == 200


def test_preferences_are_per_user_and_need_auth(seeded, auth_client):
    from rest_framework.test import APIClient
    assert APIClient().get("/api/v1/me/preferences/").status_code in (401, 403)
    a, b = auth_client(), auth_client()
    a.patch("/api/v1/me/preferences/", {"wpm": 200}, format="json")
    assert b.get("/api/v1/me/preferences/").data["wpm"] is None


# --- plans / profile --------------------------------------------------------------------------

def test_free_plan_is_seeded_and_default(user):
    c, profile = user
    assert Plan.objects.get(code="free").limits["recordings_max"] == 5
    r = c.get("/api/v1/me/entitlements/")
    assert r.data["plan"]["code"] == "free" and profile.plan_id == "free"


def test_timezone_is_validated(user):
    c, _ = user
    assert c.patch("/api/v1/me/", {"timezone": "Asia/Kolkata"}, format="json").data["timezone"] == "Asia/Kolkata"
    assert c.patch("/api/v1/me/", {"timezone": "Mars/Olympus"}, format="json").status_code == 400


# --- sessions ---------------------------------------------------------------------------------

def test_create_session_is_idempotent(user):
    c, _ = user
    body = {"client_session_id": "abc", "twister": SLUG, "mode": "read_along"}
    first = c.post("/api/v1/sessions/", body, format="json")
    again = c.post("/api/v1/sessions/", body, format="json")
    assert (first.status_code, again.status_code) == (201, 200)
    assert again["Idempotent-Replay"] == "true" and again.data["id"] == first.data["id"]
    assert PracticeSession.objects.count() == 1


def test_session_validation(user):
    c, _ = user
    assert start(c, mode="teleport").status_code == 400
    assert start(c, twister="nope").status_code == 400
    assert start(c, settings_snapshot={"x": "y" * 5000}).status_code == 400


def test_active_ms_is_monotonic_and_bounded_by_wall_clock(user):
    c, _ = user
    sid = start(c).data["id"]
    assert c.patch(f"/api/v1/sessions/{sid}/", {"active_ms": 3_600_000}, format="json").data["active_ms"] < 10_000
    age(sid, 60_000)
    assert c.patch(f"/api/v1/sessions/{sid}/", {"active_ms": 40_000}, format="json").data["active_ms"] == 40_000
    assert c.patch(f"/api/v1/sessions/{sid}/", {"active_ms": 10_000}, format="json").data["active_ms"] == 40_000


def test_qualifying_read_along_awards_streak_and_xp(user):
    c, profile = user
    sid = start(c).data["id"]
    age(sid, 60_000)
    r = finish(c, sid, active_ms=45_000)
    assert r.status_code == 200 and r.data["xp_awarded"] > 0
    assert r.data["profile"]["current_streak"] == 1 and r.data["profile"]["xp"] == r.data["xp_awarded"]
    day = DailyActivity.objects.get(profile=profile)
    assert day.qualifies_streak and day.read_along_passes == 1 and day.read_along_ms == 45_000


def test_short_or_zero_pass_read_along_does_not_qualify(user):
    c, profile = user
    for over in ({"active_ms": 10_000}, {"active_ms": 45_000, "passes_completed": 0}):
        sid = start(c).data["id"]
        age(sid, 60_000)
        r = finish(c, sid, **over)
        assert r.data["xp_awarded"] == 0 and r.data["profile"]["current_streak"] == 0
    assert not DailyActivity.objects.get(profile=profile).qualifies_streak


def test_read_along_xp_is_capped_per_day_and_streak_counts_once(user, settings):
    c, _ = user
    settings.READ_ALONG_XP_DAILY_CAP = 10
    total = 0
    for _ in range(5):
        sid = start(c).data["id"]
        age(sid, 60_000)
        r = finish(c, sid, active_ms=45_000, passes_completed=3)
        total += r.data["xp_awarded"]
    assert total == 10 and r.data["profile"]["current_streak"] == 1


def test_completion_is_idempotent_and_terminal(user):
    c, _ = user
    sid = start(c).data["id"]
    age(sid, 60_000)
    first = finish(c, sid, active_ms=45_000)
    replay = finish(c, sid, active_ms=45_000)
    assert first.data["xp_awarded"] > 0 and replay.data["xp_awarded"] == 0
    assert replay.data["profile"]["xp"] == first.data["profile"]["xp"]
    assert c.patch(f"/api/v1/sessions/{sid}/", {"active_ms": 1}, format="json").data["active_ms"] == 45_000


def test_abandoned_session_earns_nothing_and_records_reason(user):
    c, _ = user
    sid = start(c).data["id"]
    r = c.patch(f"/api/v1/sessions/{sid}/", {"status": "abandoned", "ended_reason": "tab_hidden"}, format="json")
    assert r.data["status"] == "abandoned" and r.data["ended_reason"] == "tab_hidden" and r.data["xp_awarded"] == 0
    assert c.patch(f"/api/v1/sessions/{start(c).data['id']}/", {"ended_reason": "user"}, format="json").status_code == 400


def test_sessions_are_private_to_their_owner(user, auth_client):
    c, _ = user
    sid = start(c).data["id"]
    assert auth_client().patch(f"/api/v1/sessions/{sid}/", {"active_ms": 1}, format="json").status_code == 404


# --- shared streak rules ----------------------------------------------------------------------

def test_streak_continues_next_local_day_and_resets_after_gap(user):
    c, profile = user
    from twisters.practice import services
    now = dt.datetime(2026, 9, 1, 12, tzinfo=dt.timezone.utc)
    for offset, expected in [(0, 1), (1, 2), (1, 3), (3, 1)]:
        now += dt.timedelta(days=offset)
        services.record_attempt(profile, xp=5, now=now)
        assert profile.current_streak == expected
    assert profile.best_streak == 3


def test_local_date_follows_profile_timezone(user):
    _, profile = user
    from twisters.practice import services
    profile.timezone = "Asia/Kolkata"
    late_utc = dt.datetime(2026, 9, 1, 20, 0, tzinfo=dt.timezone.utc)  # already Sep 2 in IST
    assert services.local_date(profile, late_utc) == dt.date(2026, 9, 2)
