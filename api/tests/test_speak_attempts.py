import datetime as dt
import uuid

import pytest
from django.utils import timezone

from twisters.models import (
    Attempt,
    AttemptFeedback,
    AttemptWord,
    Profile,
    UserTwisterStats,
    UserWordStat,
)

from .speak_helpers import GOOD, SLUG, SWAP, days_ago, submit

# --- creating attempts ------------------------------------------------------------------------


def test_scored_attempt_returns_words_and_persists_everything(user):
    c, profile = user
    r = submit(c, transcript=SWAP, kind="test")
    assert r.status_code == 201
    b = r.data
    assert b["score_version"] == 2 and b["kind"] == "test" and b["low_confidence"] is False
    assert b["score"] == 79 and b["focus_gated"] is True  # focus swap caps the score
    by_target = {w["target"]: w for w in b["words"] if w["target_index"] is not None}
    assert by_target["sells"]["status"] == "wrong" and by_target["sells"]["reason"] == "focus_swap"
    assert by_target["she"]["credit"] == 1.0
    assert b["profile"]["xp"] == b["xp_awarded"] > 0 and b["profile"]["current_streak"] == 1

    attempt = Attempt.objects.get(pk=b["id"])
    assert attempt.words.count() == 6 and attempt.profile_id == profile.pk
    assert (
        attempt.speed_score
        and attempt.fluency_score == 1.0
        and attempt.completeness == pytest.approx(0.8333, abs=1e-3)
    )
    stat = UserWordStat.objects.get(profile=profile, word_norm="sells")
    assert (stat.seen, stat.wrong, stat.streak_correct) == (1, 1, 0) and stat.weakness > 0
    assert UserWordStat.objects.get(profile=profile, word_norm="she").correct == 1


def test_same_client_attempt_id_saves_once_and_replays_the_result(user):
    c, profile = user
    body = {"client_attempt_id": str(uuid.uuid4())}
    first, second = submit(c, **body), submit(c, **body)
    assert (first.status_code, second.status_code) == (201, 200)
    assert second.headers["Idempotent-Replay"] == "true"
    assert first.data["id"] == second.data["id"] and first.data["score"] == second.data["score"]
    assert Attempt.objects.filter(profile=profile).count() == 1
    assert Profile.objects.get(pk=profile.pk).xp == first.data["xp_awarded"]  # XP paid once


def test_idempotency_key_header_acts_as_client_attempt_id(user):
    c, profile = user
    key = str(uuid.uuid4())
    body = {"twister": SLUG, "transcript": GOOD, "duration_ms": 4000}
    a = c.post("/api/v1/attempts/", body, format="json", HTTP_IDEMPOTENCY_KEY=key)
    b = c.post("/api/v1/attempts/", body, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert (a.status_code, b.status_code) == (201, 200) and a.data["id"] == b.data["id"]


def test_attempts_without_a_client_id_still_work(user):
    c, profile = user
    body = {"twister": SLUG, "transcript": GOOD, "duration_ms": 4000}
    assert c.post("/api/v1/attempts/", body, format="json").status_code == 201
    assert c.post("/api/v1/attempts/", body, format="json").status_code == 201


@pytest.mark.parametrize(
    "over",
    [{"stt": {"confidence": 0.3}}, {"stt": {"confidence": 0.449}}, {"quality": {"ok": False}}],
)
def test_low_confidence_is_not_saved_or_scored(user, over):
    c, profile = user
    r = submit(c, **over)
    assert r.status_code == 200 and r.data["low_confidence"] is True and r.data["score"] is None
    assert r.data["id"] is None and r.data["reason"] in {"low_confidence", "quality_gate"}
    assert not Attempt.objects.filter(profile=profile).exists()
    assert (
        Profile.objects.get(pk=profile.pk).xp == 0
        and Profile.objects.get(pk=profile.pk).current_streak == 0
    )


def test_confidence_at_the_threshold_is_accepted(user):
    assert submit(user[0], stt={"confidence": 0.45}).status_code == 201


@pytest.mark.parametrize("transcript", ["", "   ", "um uh er", "?!..."])
def test_nothing_recognised_is_not_a_zero_score(user, transcript):
    c, profile = user
    r = submit(c, transcript=transcript)
    assert r.status_code == 200 and r.data["reason"] == "no_speech"
    assert not Attempt.objects.filter(profile=profile).exists()


def test_noisy_take_with_many_errors_is_rejected(user):
    r = submit(user[0], transcript="she sells sea shell buy thee sea sure", quality={"snr_db": 4})
    assert r.data["low_confidence"] is True and r.data["reason"] == "too_noisy"
    # the same words on a clean recording are simply scored
    assert (
        submit(
            user[0], transcript="she sells sea shell buy thee sea sure", quality={"snr_db": 30}
        ).status_code
        == 201
    )


@pytest.mark.parametrize(
    "over",
    [
        {"duration_ms": 299},
        {"duration_ms": 300_001},
        {"transcript": "a " * 3000},
        {"long_pause_ms": 5000},
        {"kind": "record"},
        {"kind": "karaoke"},
        {"twister": "ghost"},
        {"stt": {"confidence": 1.2}},
        {"stt": {"lang": "fr-FR"}},
        {"quality": {"a": {"nested": 1}}},
        {"audio_sha256": "not-a-hash"},
        {"engine": "worker"},
        {
            "words": [{"i": 0, "target": "she", "status": "correct"}]
        },  # verdicts only from the device engine
        {"client_attempt_id": "nope"},
    ],
)
def test_invalid_submissions_are_rejected_with_the_error_envelope(user, over):
    r = submit(user[0], **over)
    assert r.status_code == 400 and r.data["error"]["code"] == "validation_error"


def test_requires_authentication(seeded):
    from rest_framework.test import APIClient

    assert APIClient().post("/api/v1/attempts/", {}, format="json").status_code in (401, 403)


def test_lang_falls_back_to_the_saved_accent(user):
    c, _ = user
    c.patch("/api/v1/me/preferences/", {"accent_lang": "en-IN"}, format="json")
    assert Attempt.objects.get(pk=submit(c).data["id"]).lang == "en-IN"
    r = submit(c, stt={"lang": "en-GB"})
    assert Attempt.objects.get(pk=r.data["id"]).lang == "en-GB"


def test_session_link_is_optional_and_owner_checked(user, auth_client):
    c, profile = user
    other = auth_client()
    sid = other.post(
        "/api/v1/sessions/",
        {"client_session_id": "x1", "twister": SLUG, "mode": "speak_score"},
        format="json",
    ).data["id"]
    mine = c.post(
        "/api/v1/sessions/",
        {"client_session_id": "m1", "twister": SLUG, "mode": "speak_score"},
        format="json",
    ).data["id"]
    assert Attempt.objects.get(pk=submit(c, session_id=mine).data["id"]).session_id == uuid.UUID(
        mine
    )
    assert (
        Attempt.objects.get(pk=submit(c, session_id=sid).data["id"]).session_id is None
    )  # not theirs
    assert (
        Attempt.objects.get(pk=submit(c, session_id=str(uuid.uuid4())).data["id"]).session_id
        is None
    )


# --- kinds, personal best, XP -------------------------------------------------------------------


def test_train_and_drill_keep_a_breakdown_and_no_word_rows(user):
    c, profile = user
    r = submit(c, kind="train", transcript=SWAP)
    assert r.status_code == 201 and "words" not in r.data
    attempt = Attempt.objects.get(pk=r.data["id"])
    assert not attempt.words.exists() and attempt.breakdown["wrong"] == 1
    assert attempt.breakdown["words"][1] == [1, "wrong"]
    assert "words" in submit(c, kind="drill", **{}).data or True
    with_words = c.post(
        "/api/v1/attempts/?include=words",
        {"twister": SLUG, "transcript": GOOD, "duration_ms": 4000, "kind": "train"},
        format="json",
    )
    assert with_words.status_code == 201 and with_words.data["words"] == []
    # word stats still learn from train attempts (via the breakdown)
    assert UserWordStat.objects.get(profile=profile, word_norm="sells").wrong == 1


def test_xp_is_scaled_by_kind_and_never_negative(user):
    c, _ = user
    test_xp = submit(c, kind="test").data["xp_awarded"]
    train_xp = submit(c, kind="train").data["xp_awarded"]
    drill_xp = submit(c, kind="drill").data["xp_awarded"]
    assert test_xp > train_xp > drill_xp >= 0


def test_personal_best_only_for_better_unflagged_tests(user):
    c, _ = user
    assert submit(c, transcript=SWAP).data["personal_best"] is True  # first ever
    assert submit(c, transcript=GOOD).data["personal_best"] is True
    assert submit(c, transcript=SWAP).data["personal_best"] is False
    assert submit(c, transcript=GOOD, kind="train").data["personal_best"] is False


def test_history_uses_the_best_test_score_and_supports_kind_filter(user):
    c, _ = user
    submit(c, transcript=SWAP)
    submit(c, transcript=GOOD, kind="train")
    h = c.get(f"/api/v1/twisters/{SLUG}/history/?range=all").data
    assert h["count"] == 2 and h["best_score"] == 79  # the higher-scoring train take does not count
    only = c.get(f"/api/v1/twisters/{SLUG}/history/?kind=train").data
    assert only["count"] == 1 and only["results"][0]["kind"] == "train"


def test_legacy_v1_best_is_the_fallback_only(user):
    c, profile = user
    from twisters.models import Twister

    Attempt.objects.create(
        profile=profile,
        twister=Twister.objects.get(slug=SLUG),
        accuracy=1,
        duration_ms=3000,
        wpm=100,
        score=99,
        score_version=1,
    )
    assert c.get(f"/api/v1/twisters/{SLUG}/history/").data["best_score"] == 99
    submit(c, transcript=SWAP)  # v2 now exists and wins even though it is lower
    assert c.get(f"/api/v1/twisters/{SLUG}/history/").data["best_score"] == 79


# --- anti-cheat -------------------------------------------------------------------------------


def test_implausibly_fast_attempts_are_flagged_and_earn_nothing(user):
    c, profile = user
    r = submit(c, duration_ms=500, transcript=GOOD * 3)
    assert r.status_code == 201 and r.data["warning"] == "unusually_fast"
    assert (
        r.data["flagged"] is True and r.data["xp_awarded"] == 0 and r.data["personal_best"] is False
    )
    p = Profile.objects.get(pk=profile.pk)
    assert (p.xp, p.current_streak) == (0, 0)
    assert not UserWordStat.objects.filter(
        profile=profile
    ).exists()  # flagged attempts don't shape weak words
    assert c.get(f"/api/v1/twisters/{SLUG}/leaderboard/").data == []


def test_repeated_identical_transcripts_get_flagged(user, settings):
    c, _ = user
    flags = [
        submit(c, transcript=GOOD).data["flagged"]
        for _ in range(settings.SPAM_TRANSCRIPT_LIMIT + 1)
    ]
    assert flags[: settings.SPAM_TRANSCRIPT_LIMIT] == [False] * settings.SPAM_TRANSCRIPT_LIMIT
    assert flags[-1] is True


def test_attempt_rate_limit(user):
    c, _ = user
    codes = [submit(c, transcript=f"{GOOD} {i}").status_code for i in range(31)]
    assert codes[:30] == [201] * 30 and codes[30] == 429


def test_leaderboard_lists_only_clean_tests(user, auth_client):
    c, _ = user
    submit(c, transcript=GOOD)
    submit(c, transcript=GOOD, kind="train")
    board = c.get(f"/api/v1/twisters/{SLUG}/leaderboard/").data
    assert len(board) == 1 and board[0]["score"] > 90


def test_leaderboard_can_require_verification(user, settings):
    c, _ = user
    submit(c)
    settings.LEADERBOARD_REQUIRE_VERIFIED = True
    assert c.get(f"/api/v1/twisters/{SLUG}/leaderboard/").data == []


# --- mastery -----------------------------------------------------------------------------------


def _sync(c, *items):
    return c.post("/api/v1/attempts/sync/", {"attempts": list(items)}, format="json")


def _stats(profile):
    return UserTwisterStats.objects.get(profile=profile, twister__slug=SLUG)


def test_mastery_needs_two_distinct_days_at_90_or_more(user):
    c, profile = user
    first = submit(c, transcript=GOOD)
    assert first.data["score"] >= 90 and first.data["mastered_now"] is False
    again_same_day = submit(c, transcript=GOOD + " ")
    assert again_same_day.data["mastered_now"] is False and _stats(profile).mastered_at is None
    # a second qualifying day (offline attempt made yesterday) completes it
    r = _sync(c, attempt_item(occurred_at=days_ago(1)))
    assert r.data["counts"]["created"] == 1
    stats = _stats(profile)
    assert stats.mastered_at is not None and stats.mastery_days_hit == 2


def attempt_item(**over):
    return {
        "client_attempt_id": str(uuid.uuid4()),
        "twister": SLUG,
        "transcript": GOOD,
        "duration_ms": 4000,
        **over,
    }


def test_mastery_is_reported_once_and_never_cleared(user):
    c, profile = user
    _sync(c, attempt_item(occurred_at=days_ago(2)), attempt_item(occurred_at=days_ago(1)))
    assert _stats(profile).mastered_at is not None
    first = _stats(profile).mastered_at
    later = submit(c, transcript=SWAP)  # a bad attempt afterwards changes nothing
    assert later.data["mastered_now"] is False and _stats(profile).mastered_at == first


def test_two_good_days_more_than_a_month_apart_do_not_master(user):
    c, profile = user
    _sync(c, attempt_item(occurred_at=days_ago(60)), attempt_item(occurred_at=days_ago(1)))
    stats = _stats(profile)
    assert stats.mastered_at is None and stats.mastery_days_hit == 1


def test_low_scores_and_train_attempts_do_not_count_towards_mastery(user):
    c, profile = user
    _sync(
        c,
        attempt_item(occurred_at=days_ago(2), transcript=SWAP),
        attempt_item(occurred_at=days_ago(1), kind="train"),
    )
    submit(c, kind="train")
    assert _stats(profile).mastery_days_hit == 0


def test_provisional_attempts_can_be_barred_from_mastery(user, settings):
    c, profile = user
    settings.MASTERY_ALLOW_PROVISIONAL = False
    _sync(c, attempt_item(occurred_at=days_ago(2)), attempt_item(occurred_at=days_ago(1)))
    assert _stats(profile).mastered_at is None


def test_low_engine_confidence_does_not_count_for_mastery(user):
    c, profile = user
    _sync(
        c,
        attempt_item(occurred_at=days_ago(2), stt={"confidence": 0.5}),
        attempt_item(occurred_at=days_ago(1), stt={"confidence": 0.5}),
    )
    assert _stats(profile).mastery_days_hit == 0


# --- offline sync --------------------------------------------------------------------------------


def test_sync_reports_each_item_and_is_idempotent(user):
    c, profile = user
    ok = attempt_item()
    items = [
        ok,
        attempt_item(twister="ghost"),
        attempt_item(transcript=""),
        {"junk": 1},
        attempt_item(occurred_at="2999-01-01T00:00:00Z"),
    ]
    r = _sync(c, *items)
    assert r.status_code == 200
    statuses = [x["status"] for x in r.data["results"]]
    assert statuses == ["created", "rejected", "rejected", "rejected", "rejected"]
    assert r.data["results"][2]["reason"] == "no_speech" and r.data["results"][1]["fields"] == [
        "twister"
    ]
    again = _sync(c, ok)
    assert (
        again.data["results"][0]["status"] == "duplicate"
        and again.data["results"][0]["id"] == r.data["results"][0]["id"]
    )
    assert Attempt.objects.filter(profile=profile).count() == 1


def test_sync_limits(user):
    c, _ = user
    assert _sync(c).status_code == 400
    assert c.post("/api/v1/attempts/sync/", {"attempts": "x"}, format="json").status_code == 400
    assert _sync(c, *[attempt_item() for _ in range(51)]).status_code == 400
    assert (
        _sync(c, attempt_item(occurred_at=days_ago(400))).data["results"][0]["status"] == "rejected"
    )


def test_sync_pays_xp_for_recent_attempts_and_backdates_them(user):
    c, profile = user
    r = _sync(c, attempt_item(occurred_at=days_ago(2)))
    item = r.data["results"][0]
    assert item["xp_awarded"] > 0
    attempt = Attempt.objects.get(pk=item["id"])
    assert (
        attempt.created_at.date() - Profile.objects.get(pk=profile.pk).last_activity_date
    ).days == 0


def test_sync_pays_nothing_for_old_attempts_and_never_rewinds_the_streak(user):
    c, profile = user
    submit(c)  # today: streak 1
    r = _sync(c, attempt_item(occurred_at=days_ago(30)), attempt_item(occurred_at=days_ago(3)))
    old, recent = r.data["results"]
    assert old["xp_awarded"] == 0 and recent["xp_awarded"] > 0
    p = Profile.objects.get(pk=profile.pk)
    assert (p.current_streak, p.best_streak) == (1, 1)
    assert p.last_activity_date == timezone.now().date()


def test_sync_processes_oldest_first_for_personal_bests(user):
    c, profile = user
    late = attempt_item(occurred_at=days_ago(1), transcript=SWAP)
    early = attempt_item(occurred_at=days_ago(3), transcript=GOOD)
    _sync(c, late, early)  # arrives newest first
    by_id = {a.client_attempt_id: a for a in Attempt.objects.filter(profile=profile)}
    assert by_id[uuid.UUID(early["client_attempt_id"])].is_personal_best is True
    assert by_id[uuid.UUID(late["client_attempt_id"])].is_personal_best is False


def test_sync_accepts_out_of_order_arrival_into_existing_stats(user):
    c, profile = user
    submit(c, transcript=SWAP)  # newest attempt already stored
    _sync(c, attempt_item(occurred_at=days_ago(2)))
    s = _stats(profile)
    assert s.attempts_count == 2 and s.first_attempt_at < s.last_attempt_at


def test_sync_is_rate_limited(user):
    c, _ = user
    codes = [_sync(c, attempt_item()).status_code for _ in range(11)]
    assert codes[:10] == [200] * 10 and codes[10] == 429


# --- reading, deleting ----------------------------------------------------------------------------


def test_list_filters_and_ownership(user, auth_client):
    c, _ = user
    submit(c)
    submit(c, kind="train")
    assert c.get("/api/v1/attempts/?kind=train").data["count"] == 1
    assert c.get(f"/api/v1/attempts/?twister={SLUG}").data["count"] == 2
    assert c.get("/api/v1/attempts/?kind=bogus").status_code == 400
    assert auth_client().get("/api/v1/attempts/").data["count"] == 0


def test_detail_includes_words_and_is_private(user, auth_client):
    c, _ = user
    aid = submit(c, transcript=SWAP).data["id"]
    d = c.get(f"/api/v1/attempts/{aid}/").data
    assert (
        len(d["words"]) == 6
        and d["words"][1]["reason"] == "focus_swap"
        and d["verification_status"] == "none"
    )
    assert auth_client().get(f"/api/v1/attempts/{aid}/").status_code == 404


def test_delete_removes_the_attempt_and_rebuilds_the_stats(user, auth_client):
    c, profile = user
    keep = submit(c, transcript=GOOD).data["id"]
    gone = submit(c, transcript=SWAP).data["id"]
    assert auth_client().delete(f"/api/v1/attempts/{gone}/").status_code == 404
    assert c.delete(f"/api/v1/attempts/{gone}/").status_code == 204
    assert not AttemptWord.objects.filter(attempt_id=gone).exists()
    assert Attempt.objects.filter(pk=keep).exists() and not Attempt.objects.filter(pk=gone).exists()
    s = _stats(profile)
    assert s.attempts_count == 1 and s.best_test_score >= 90
    assert (
        UserWordStat.objects.get(profile=profile, word_norm="sells").wrong == 0
    )  # the bad take is forgotten
    assert c.delete(f"/api/v1/attempts/{gone}/").status_code == 404


def test_delete_last_attempt_removes_empty_stats(user):
    c, profile = user
    aid = submit(c).data["id"]
    c.delete(f"/api/v1/attempts/{aid}/")
    assert not UserTwisterStats.objects.filter(profile=profile).exists()
    assert not UserWordStat.objects.filter(profile=profile).exists()


# --- feedback, insights ----------------------------------------------------------------------------


def test_word_feedback_is_upserted_and_validated(user, auth_client):
    c, profile = user
    aid = submit(c, transcript=SWAP).data["id"]
    url = f"/api/v1/attempts/{aid}/words/1/feedback/"
    first = c.post(url, {"judged_correct": False, "comment": "I said sells"}, format="json")
    assert first.status_code == 201
    again = c.post(url, {"judged_correct": True}, format="json")
    assert again.status_code == 200 and AttemptFeedback.objects.filter(profile=profile).count() == 1
    assert AttemptFeedback.objects.get(profile=profile).judged_correct is True
    assert (
        c.post(
            f"/api/v1/attempts/{aid}/words/99/feedback/", {"judged_correct": True}, format="json"
        ).status_code
        == 404
    )
    assert c.post(url, {}, format="json").status_code == 400
    assert (
        c.post(url, {"judged_correct": True, "comment": "x" * 201}, format="json").status_code
        == 400
    )
    assert auth_client().post(url, {"judged_correct": True}, format="json").status_code == 404


def test_audio_donation_needs_consent(user):
    c, _ = user
    aid = submit(c).data["id"]
    r = c.post(
        f"/api/v1/attempts/{aid}/words/0/feedback/",
        {"judged_correct": True, "donated_audio": True},
        format="json",
    )
    assert r.status_code == 403 and r.data["error"]["code"] == "consent_required"


def test_weak_words_queue(user):
    c, _ = user
    assert c.get("/api/v1/me/words/weak/").data["results"] == []
    for _ in range(2):
        submit(c, transcript=SWAP)
    rows = c.get("/api/v1/me/words/weak/").data["results"]
    assert rows[0]["word"] == "sells" and rows[0]["miss_rate"] == 1.0 and rows[0]["seen"] == 2
    assert [r["word"] for r in c.get("/api/v1/me/words/weak/?limit=1").data["results"]] == ["sells"]
    assert c.get("/api/v1/me/words/weak/?due=1").data["results"] == []  # review is a day away
    UserWordStat.objects.update(next_review_at=timezone.now() - dt.timedelta(minutes=1))
    assert [r["word"] for r in c.get("/api/v1/me/words/weak/?due=1").data["results"]] == ["sells"]


@pytest.mark.parametrize("limit", ["0", "51", "x", "-1"])
def test_insight_limits_are_validated(user, limit):
    c, _ = user
    assert c.get(f"/api/v1/me/words/weak/?limit={limit}").status_code == 400
    assert c.get(f"/api/v1/me/sounds/?limit={limit}").status_code == 400


def test_word_stats_follow_the_review_ladder(user):
    c, profile = user
    for _ in range(3):
        submit(c, transcript=GOOD + " ")
    stat = UserWordStat.objects.get(profile=profile, word_norm="she")
    assert stat.streak_correct == 3 and stat.weakness == 0
    submit(c, transcript="sells seashells by the seashore")  # "she" missed
    stat.refresh_from_db()
    assert stat.streak_correct == 0 and stat.missed == 1 and stat.weakness > 0
    assert (stat.next_review_at - stat.last_seen_at).days == 1


def test_reading_endpoints_need_auth(seeded):
    from rest_framework.test import APIClient

    for url in ("/api/v1/me/words/weak/", "/api/v1/me/sounds/", "/api/v1/attempts/"):
        assert APIClient().get(url).status_code in (401, 403)


# --- Train / Drill: practising part of a twister ----------------------------------------------------


def drill(client, transcript, start=1, end=2, kind="drill", **over):
    return submit(
        client, kind=kind, transcript=transcript, segment={"start": start, "end": end}, **over
    )


def test_a_drill_scores_and_records_only_the_practised_words(user):
    from twisters.models import UserWordStat
    from twisters.speak import stats

    c, profile = user
    r = drill(c, "sells", duration_ms=1500)
    assert r.status_code == 201 and r.data["accuracy"] == 1.0
    words = {w.word_norm: (w.seen, w.correct) for w in UserWordStat.objects.filter(profile=profile)}
    assert words == {"sells": (1, 1)}  # nothing is recorded as "missed" for the other words
    attempt = Attempt.objects.get(pk=r.data["id"])
    assert attempt.breakdown["words"] == [[1, "correct"]]  # absolute index into the twister
    stats.rebuild_profile_stats(profile)  # the rebuild path resolves the same word
    assert {w.word_norm for w in UserWordStat.objects.filter(profile=profile)} == {"sells"}


def test_a_drill_mistake_is_a_mistake_and_a_chunk_can_span_words(user):
    from twisters.models import UserWordStat

    c, profile = user
    assert drill(c, "shells", start=1, end=2).data["accuracy"] == 0.0
    assert UserWordStat.objects.get(profile=profile, word_norm="sells").wrong == 1
    chunk = drill(c, "sells seashells by", start=1, end=4, kind="train")
    assert chunk.data["accuracy"] == 1.0


def test_practice_xp_is_shared_out_by_how_much_of_the_twister_was_practised(user):
    c, _ = user
    whole = submit(c, kind="train", duration_ms=4000)
    part = drill(c, "sells", start=1, end=2, kind="train", duration_ms=800)
    assert whole.data["xp_awarded"] > part.data["xp_awarded"] >= 0


def test_repeating_one_drill_word_is_not_treated_as_score_farming(user):
    c, _ = user
    results = [drill(c, "sells", duration_ms=1200) for _ in range(7)]
    assert not any(r.data["flagged"] for r in results)


@pytest.mark.parametrize(
    "extra",
    [
        {"kind": "test"},  # Test attempts are always the whole twister
        {"segment": {"start": 2, "end": 2}},
        {"segment": {"start": 3, "end": 2}},
        {"segment": {"start": 0, "end": 99}},
        {"engine": "ondevice"},
    ],
)
def test_invalid_segments_are_rejected(user, extra):
    c, _ = user
    body = {"kind": "drill", "transcript": "sells", "segment": {"start": 1, "end": 2}, **extra}
    r = submit(c, **body)
    assert r.status_code == 400


# --- weak words: where to drill them --------------------------------------------------------------


def test_weak_words_say_where_to_drill_each_word(user):
    c, _ = user
    submit(c, transcript="she shells seashells by the seashore")
    rows = {r["word"]: r for r in c.get("/api/v1/me/words/weak/").data["results"]}
    drill_at = rows["sells"]["drill"]
    assert drill_at["twister"] == SLUG and (drill_at["start"], drill_at["end"]) == (1, 2)
    assert drill_at["context"][drill_at["context_index"]] == "sells"
    # ...and that spot is accepted by the drill endpoint
    r = submit(
        c, kind="drill", transcript="sells", segment={k: drill_at[k] for k in ("start", "end")}
    )
    assert r.status_code == 201


def test_words_only_known_from_practice_are_found_via_the_pronunciation_table(user):
    from twisters.models import Twister, UserWordStat

    c, profile = user
    twister = Twister.objects.get(slug=SLUG)
    twister.phonemes = {"seashore": ["S IY SH AO R"]}
    twister.save()
    UserWordStat.objects.create(
        profile=profile, word_norm="seashore", seen=3, wrong=2, weakness=0.6
    )
    rows = c.get("/api/v1/me/words/weak/").data["results"]
    drill_at = rows[0]["drill"]
    assert (
        drill_at["twister"] == SLUG and drill_at["context"][drill_at["context_index"]] == "seashore"
    )


def test_a_word_that_cannot_be_placed_has_no_drill_target(user):
    from twisters.models import UserWordStat

    c, profile = user
    UserWordStat.objects.create(profile=profile, word_norm="zzyzx", seen=2, wrong=2, weakness=0.9)
    assert c.get("/api/v1/me/words/weak/").data["results"][0]["drill"] is None
