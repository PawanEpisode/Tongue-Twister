"""`GET /me/export/`: shape, leak-proofing, the attempt cap, throttling and isolation between users."""

import datetime as dt
import json
import re

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from twisters.models import (
    AttemptWord,
    DailyActivity,
    Favorite,
    PracticeSession,
    Recording,
    UserAchievement,
    UserConsent,
    UserPhonemeStat,
    UserPreference,
    UserWordStat,
)

from .media_helpers import API, saved_recording
from .progress_helpers import at, freeze_time, make_attempt, make_stats, new_profile, twister
from .speak_helpers import SLUG, submit

pytestmark = pytest.mark.django_db
SECTIONS = [
    "schema_version",
    "generated_at",
    "profile",
    "preferences",
    "reminders",
    "favorites",
    "sessions",
    "daily_activity",
    "generated_twisters",
    "stats",
    "achievements",
    "recordings",
    "consents",
    "attempts",  # last: they take what the byte budget has left
    "truncated",  # last of all: only known once the attempts are written
]
# Nothing like these may appear as a key anywhere in an export (hashes, storage, worker internals).
FORBIDDEN_KEYS = {
    "ip_hash",
    "reporter_ip_hash",
    "token_hash",
    "token",
    "bucket",
    "path",
    "signed_url",
    "upload",
    "playback",
    "nonce",
    "audio_sha256",
    "checksum_sha256",
    "sha256",
    "voice_asset_id",
    "video_asset",
    "storage_ledger",
    "quality",
    "engine_version",
    "model_version",
    "scoring_profile",
    "spot_checked",
    "spot_check_delta",
    "verification_status",
    "flagged",
    "confidence",
    "acoustic_score",
    "client_attempt_id",
    "client_recording_id",
    "client_session_id",
    "user_agent_family",
    "settings_snapshot",
    "plan_limits",
}


def fetch(client, **extra):
    response = client.get(f"{API}/me/export/", **extra)
    assert response.status_code == 200, getattr(response, "data", response.content)
    return json.loads(b"".join(response.streaming_content)), response


def keys_of(node):
    """Every dict key at any depth."""
    if isinstance(node, dict):
        for key, value in node.items():
            yield key
            yield from keys_of(value)
    elif isinstance(node, list):
        for item in node:
            yield from keys_of(item)


def strings_of(node):
    if isinstance(node, dict):
        for value in node.values():
            yield from strings_of(value)
    elif isinstance(node, list):
        for item in node:
            yield from strings_of(item)
    elif isinstance(node, str):
        yield node


@pytest.fixture
def full(cloud_user, storage, settings):
    """A user with a bit of everything, including things an export must never expose."""
    client, profile = cloud_user
    first = submit(client, transcript="she shells seashells by the seashore").data
    submit(client)
    client.post(f"{API}/attempts/{first['id']}/score-card/")
    saved_recording(client, storage, title="My take")
    tw = twister(SLUG)
    Favorite.objects.create(profile=profile, twister=tw)
    UserPreference.objects.create(profile=profile, wpm=120)
    PracticeSession.objects.create(
        profile=profile, twister=tw, client_session_id="s1", mode="read_along"
    )
    UserPhonemeStat.objects.create(profile=profile, phoneme_pair="S>SH", occurrences=3, errors=1)
    UserWordStat.objects.create(profile=profile, word_norm="shells", seen=2)
    DailyActivity.objects.create(profile=profile, local_date=dt.date(2026, 9, 1), attempts=2)
    make_stats(profile, new_twister_other(tw), attempts_count=2)
    return client, profile


def new_twister_other(exclude):
    from twisters.models import Twister

    return Twister.objects.exclude(pk=exclude.pk).first()


# --- shape -----------------------------------------------------------------------------------------------


def test_the_export_is_a_json_download_with_every_section(full, monkeypatch):
    client, profile = full
    freeze_time(monkeypatch, at(2026, 9, 10, 12))
    body, response = fetch(client)
    assert list(body) == SECTIONS
    assert response["Content-Type"] == "application/json"
    assert response["Content-Disposition"] == 'attachment; filename="twister-export-20260910.json"'
    assert response["Cache-Control"] == "private, no-store"
    assert body["schema_version"] == 1 and body["truncated"] is False
    assert body["generated_at"].startswith("2026-09-10T12:00:00")
    assert body["profile"]["id"] == str(profile.pk) and body["profile"]["email"] == profile.email
    assert body["preferences"]["wpm"] == 120
    assert body["favorites"] == [SLUG]
    assert set(body["stats"]) == {"twisters", "words", "phonemes"}
    assert body["stats"]["phonemes"] == [
        {"phoneme_pair": "S>SH", "occurrences": 3, "errors": 1, "error_rate": 0.0}
    ]
    assert "shells" in [w["word_norm"] for w in body["stats"]["words"]]
    assert {t["twister"] for t in body["stats"]["twisters"]} >= {SLUG}
    assert [s["mode"] for s in body["sessions"]] == ["read_along"]
    assert body["daily_activity"][0]["local_date"] == "2026-09-01"
    assert {a["code"] for a in body["achievements"]} >= {"first_word"}
    assert [c["type"] for c in body["consents"]] and set(body["consents"][0]) == {
        "type",
        "version",
        "granted_at",
        "revoked_at",
    }


def test_attempts_are_newest_first_and_carry_their_words(full):
    client, profile = full
    body, _ = fetch(client)
    attempts = body["attempts"]
    assert len(attempts) == 2
    assert attempts[0]["created_at"] >= attempts[1]["created_at"]
    assert all(a["twister"] == SLUG and a["id"] for a in attempts)
    stored = AttemptWord.objects.filter(attempt__profile=profile).count()
    assert stored and sum(len(a["words"]) for a in attempts) == stored
    assert {"target_word", "status", "credit"} <= set(attempts[0]["words"][0])


def test_recording_metadata_is_included_without_storage_details(full):
    client, profile = full
    body, _ = fetch(client)
    (rec,) = body["recordings"]
    assert rec["title"] == "My take" and rec["status"] == "ready" and rec["size_bytes"] > 0
    assert not {"video_asset", "thumbnail_asset", "bucket", "path"} & set(rec)


def test_deleted_recordings_are_not_exported(full):
    client, profile = full
    Recording.objects.filter(profile=profile).update(status="deleted")
    assert fetch(client)[0]["recordings"] == []


def test_revoked_achievements_are_not_exported(full):
    client, profile = full
    UserAchievement.objects.filter(profile=profile).update(revoked=True)
    assert fetch(client)[0]["achievements"] == []


def test_an_empty_account_exports_cleanly(user):
    client, _ = user
    body, _ = fetch(client)
    assert (
        body["preferences"] is None
        and body["reminders"] is None
        and body["favorites"] == []
        and body["attempts"] == []
    )
    assert body["stats"] == {"twisters": [], "words": [], "phonemes": []}


def test_unicode_survives(user):
    client, profile = user
    make_attempt(profile, twister(), transcript="café — 你好 🎤")
    assert fetch(client)[0]["attempts"][0]["transcript"] == "café — 你好 🎤"


# --- leak-proofing ---------------------------------------------------------------------------------------


def test_no_forbidden_key_appears_anywhere(full):
    client, _ = full
    body, _ = fetch(client)
    assert FORBIDDEN_KEYS.isdisjoint(keys_of(body))


def test_no_secret_looking_value_appears_anywhere(full):
    """Share tokens, storage paths and signed URLs are values, not just keys; none may sneak in."""
    client, profile = full
    from twisters.models import MediaAsset, ShareLink

    secrets = {s.token_hash for s in ShareLink.objects.all()}
    secrets |= {a.path for a in MediaAsset.objects.all()} | {
        a.bucket for a in MediaAsset.objects.all()
    }
    values = list(strings_of(fetch(client)[0]))
    joined = "\n".join(values)
    assert secrets and not any(secret in joined for secret in secrets)
    assert "memory://" not in joined and "token=" not in joined
    assert not any(re.fullmatch(r"[0-9a-f]{64}", v) for v in values), (
        "a sha256-looking value leaked"
    )


def test_other_users_data_never_appears(full):
    client, profile = full
    other = new_profile(
        email="stranger@example.com", display_name="Stranger", public_name="Strange"
    )
    make_attempt(other, twister(), transcript="stranger transcript")
    UserConsent.objects.create(profile=other, type="marketing", version="v1", ip_hash="f" * 64)
    UserWordStat.objects.create(profile=other, word_norm="strangerword")
    Favorite.objects.create(profile=other, twister=twister())
    text = json.dumps(fetch(client)[0])
    for marker in ("stranger", "Stranger", "Strange", "strangerword", str(other.pk), "f" * 64):
        assert marker not in text, marker


# --- the cap, chunks, cost -------------------------------------------------------------------------------


def test_the_attempt_cap_keeps_the_newest_and_says_so(user, settings):
    client, profile = user
    settings.EXPORT_MAX_ATTEMPTS = 3
    tw = twister()
    for day in range(1, 6):
        make_attempt(profile, tw, when=at(2026, 9, day), score=day)
    body, _ = fetch(client)
    assert body["truncated"] is True
    assert [a["score"] for a in body["attempts"]] == [5, 4, 3]


def test_exactly_the_cap_is_not_truncated(user, settings):
    client, profile = user
    settings.EXPORT_MAX_ATTEMPTS = 3
    for day in range(1, 4):
        make_attempt(profile, twister(), when=at(2026, 9, day))
    body, _ = fetch(client)
    assert body["truncated"] is False and len(body["attempts"]) == 3


def test_the_default_cap_is_twenty_thousand(settings):
    assert settings.EXPORT_MAX_ATTEMPTS == 20_000


def test_chunking_does_not_change_the_result(user, settings):
    client, profile = user
    tw = twister()
    for day in range(1, 8):
        attempt = make_attempt(profile, tw, when=at(2026, 9, day), score=day)
        AttemptWord.objects.create(
            attempt=attempt, target_word=f"w{day}", status="correct", credit=1
        )
    whole, _ = fetch(client)
    settings.EXPORT_CHUNK_SIZE = 2
    chunked, _ = fetch(client)
    assert chunked["attempts"] == whole["attempts"]
    assert [a["words"][0]["target_word"] for a in chunked["attempts"]] == [
        f"w{d}" for d in range(7, 0, -1)
    ]


def test_the_number_of_queries_does_not_grow_with_the_data(
    user, settings, django_assert_max_num_queries
):
    client, profile = user
    tw = twister()

    def queries() -> int:
        with CaptureQueriesContext(connection) as captured:
            fetch(client)
        return len(captured)

    for _ in range(3):
        AttemptWord.objects.create(
            attempt=make_attempt(profile, tw), target_word="a", status="correct", credit=1
        )
    small = queries()
    for _ in range(40):
        AttemptWord.objects.create(
            attempt=make_attempt(profile, tw), target_word="a", status="correct", credit=1
        )
    assert queries() == small


def test_the_body_is_streamed(user):
    client, _ = user
    assert client.get(f"{API}/me/export/").streaming is True


# --- access and throttling -------------------------------------------------------------------------------


def test_the_export_needs_a_signed_in_user(anon):
    assert anon.get(f"{API}/me/export/").status_code in (401, 403)


def test_three_exports_an_hour_then_429(user):
    client, _ = user
    for _ in range(3):
        assert client.get(f"{API}/me/export/").status_code == 200
    blocked = client.get(f"{API}/me/export/")
    assert blocked.status_code == 429 and blocked.data["error"]["code"] == "rate_limited"


def test_the_throttle_is_per_user(user, auth_client):
    client, _ = user
    for _ in range(3):
        client.get(f"{API}/me/export/")
    assert auth_client().get(f"{API}/me/export/").status_code == 200
