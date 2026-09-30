import datetime as dt
import uuid

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from twisters.models import Attempt, Favorite, FeatureFlag, Profile, SyncBatch, UserPreference
from twisters.practice import flags

GOOD = "peter piper picked a peck of pickled peppers"


@pytest.fixture
def user(seeded, auth_client):
    sub = str(uuid.uuid4())
    client = auth_client(sub)
    client.get("/api/v1/me/")
    return client, Profile.objects.get(pk=sub)


def attempt(**over):
    return {
        "client_attempt_id": str(uuid.uuid4()),
        "twister": "peter-piper",
        "transcript": GOOD,
        "duration_ms": 3000,
        **over,
    }


def sync(client, **body):
    return client.post(
        "/api/v1/sync/guest/", {"client_batch_id": str(uuid.uuid4()), **body}, format="json"
    )


# --- guest sync ----------------------------------------------------------------------------------


def test_sync_imports_attempts_favorites_and_prefs_without_xp(user):
    c, profile = user
    r = sync(
        c,
        preferences={"wpm": 140},
        favorites=["peter-piper", "nope"],
        attempts=[attempt(), attempt(transcript="hello")],
    )
    assert r.status_code == 201 and r.data == {
        "attempts_imported": 2,
        "favorites_imported": 1,
        "rejected": 0,
    }
    profile.refresh_from_db()
    assert (profile.xp, profile.current_streak) == (0, 0) and profile.guest_migrated_at
    assert Attempt.objects.filter(profile=profile, xp_awarded=0).count() == 2
    assert (
        Attempt.objects.filter(profile=profile).order_by("-score").first().score > 90
    )  # re-scored server-side
    assert UserPreference.objects.get(profile=profile).wpm == 140


def test_sync_is_idempotent_per_batch_and_per_attempt(user):
    c, profile = user
    body = {
        "client_batch_id": str(uuid.uuid4()),
        "attempts": [attempt()],
        "favorites": ["peter-piper"],
    }
    first = c.post("/api/v1/sync/guest/", body, format="json")
    again = c.post("/api/v1/sync/guest/", body, format="json")
    assert (first.status_code, again.status_code) == (201, 200) and again[
        "Idempotent-Replay"
    ] == "true"
    assert (
        again.data == first.data and Attempt.objects.count() == 1 and SyncBatch.objects.count() == 1
    )
    # A *new* batch re-sending the same attempt id must not duplicate it.
    dup = sync(c, attempts=[body["attempts"][0]], favorites=["peter-piper"])
    assert dup.data == {"attempts_imported": 0, "favorites_imported": 0, "rejected": 0}
    assert Attempt.objects.count() == 1 and Favorite.objects.count() == 1


def test_sync_rejects_bad_rows_but_keeps_the_rest(user):
    c, _ = user
    r = sync(c, attempts=[attempt(), attempt(twister="ghost"), attempt(duration_ms=1), {"junk": 1}])
    assert r.data["attempts_imported"] == 1 and r.data["rejected"] == 3


def test_sync_limits_and_auth(user):
    c, _ = user
    assert sync(c, attempts=[attempt() for _ in range(51)]).status_code == 400
    assert APIClient().post("/api/v1/sync/guest/", {}, format="json").status_code in (401, 403)


def test_sync_backdates_within_a_year_and_never_into_the_future(user):
    c, profile = user
    old = (timezone.now() - dt.timedelta(days=3)).isoformat()
    ancient = (timezone.now() - dt.timedelta(days=900)).isoformat()
    future = (timezone.now() + dt.timedelta(days=5)).isoformat()
    sync(
        c,
        attempts=[attempt(created_at=old), attempt(created_at=ancient), attempt(created_at=future)],
    )
    dates = sorted(Attempt.objects.filter(profile=profile).values_list("created_at", flat=True))
    now = timezone.now()
    assert dates[0] >= now - dt.timedelta(days=366) and dates[-1] <= now
    assert any(abs((d - dt.datetime.fromisoformat(old)).total_seconds()) < 5 for d in dates)


def test_existing_preferences_win_over_guest_ones(user):
    c, _ = user
    c.patch("/api/v1/me/preferences/", {"wpm": 90}, format="json")
    sync(c, preferences={"wpm": 200})
    assert c.get("/api/v1/me/preferences/").data["wpm"] == 90


# --- feature flags ---------------------------------------------------------------------------------


def test_flags_seeded_and_served_to_guests_and_users(user):
    c, _ = user
    for client in (APIClient(), c):
        f = client.get("/api/v1/flags/").data["flags"]
        assert f["practice_hub"] is True and f["read_along"] is True and f["record_cloud"] is False


def test_flag_evaluation_rules(user):
    _, profile = user
    f = FeatureFlag(code="x", enabled=True, rollout_pct=0)
    assert not flags.is_on(f, profile) and not flags.is_on(f, None)
    f.allow_list = [str(profile.pk)]
    assert flags.is_on(f, profile)
    f.rollout_pct = 100
    assert flags.is_on(f, None)
    f.enabled = False  # kill switch beats allow-list and rollout
    assert not flags.is_on(f, profile)


def test_percentage_rollout_is_stable_and_monotonic():
    ids = [uuid.uuid4() for _ in range(400)]
    on = lambda pct: {i for i in ids if flags._bucket("f", i) < pct}  # noqa: E731
    assert on(25) <= on(50) <= on(100) == set(ids) and on(0) == set()
    assert 60 < len(on(25)) < 140  # roughly a quarter


# --- error envelope --------------------------------------------------------------------------------


def test_errors_use_the_envelope_and_echo_request_id(seeded):
    c = APIClient()
    r = c.get("/api/v1/twisters/nope/", headers={"X-Request-Id": "req-123"})
    assert r.status_code == 404 and r["X-Request-Id"] == "req-123"
    assert r.data["error"] == {
        "code": "not_found",
        "message": "No Twister matches the given query.",
        "details": {},
        "request_id": "req-123",
    }
    r = c.get("/api/v1/twisters/", headers={"X-Request-Id": "bad id!"})
    assert r["X-Request-Id"] not in ("", "bad id!")


def test_validation_and_auth_and_conflict_codes(user):
    c, _ = user
    v = c.patch("/api/v1/me/preferences/", {"wpm": 5}, format="json")
    assert v.data["error"]["code"] == "validation_error" and "wpm" in v.data["error"]["details"]
    assert (
        APIClient().post("/api/v1/attempts/", {}, format="json").data["error"]["code"]
        == "unauthenticated"
    )
    stale = c.patch(
        "/api/v1/me/preferences/",
        {"wpm": 90},
        format="json",
        headers={"If-Unmodified-Since": "Mon, 01 Jan 2001 00:00:00 GMT"},
    )
    assert stale.status_code == 409 and stale.data["error"]["code"] == "conflict"


# --- history ---------------------------------------------------------------------------------------


def test_history_lists_own_attempts_with_totals(user, auth_client):
    c, _ = user
    for spoken in (GOOD, "peter piper", GOOD):
        c.post(
            "/api/v1/attempts/",
            {"twister": "peter-piper", "transcript": spoken, "duration_ms": 3000},
            format="json",
        )
    r = c.get("/api/v1/twisters/peter-piper/history/?range=10")
    assert (
        r.data["count"] == 3
        and len(r.data["results"]) == 3
        and r.data["best_score"] >= r.data["results"][0]["score"]
    )
    assert len(c.get("/api/v1/twisters/peter-piper/history/?range=all").data["results"]) == 3
    Attempt.objects.bulk_create(
        [
            Attempt(
                profile=Profile.objects.get(),
                twister_id=r_id,
                accuracy=1,
                duration_ms=1000,
                wpm=1,
                score=1,
            )
            for r_id in [Attempt.objects.first().twister_id] * 9
        ]
    )
    assert (
        len(c.get("/api/v1/twisters/peter-piper/history/?range=10").data["results"]) == 10
    )  # capped
    assert c.get("/api/v1/twisters/peter-piper/history/?range=7").status_code == 400
    assert auth_client().get("/api/v1/twisters/peter-piper/history/").data["count"] == 0
    assert APIClient().get("/api/v1/twisters/peter-piper/history/").status_code in (401, 403)
