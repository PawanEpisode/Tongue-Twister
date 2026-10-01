"""The achievements engine: every rule at its boundary, idempotence, trust, failure isolation, the
attempt/session/recording hooks and the catalogue sync."""

import datetime as dt
import logging
import uuid

import pytest
from django.core.management import call_command

from twisters.models import (
    Achievement,
    Category,
    DailyActivity,
    Profile,
    Twister,
    UserAchievement,
)
from twisters.progress import achievements
from twisters.progress.achievements import Event, Rule
from twisters.progress.catalogue import CATALOGUE

from .media_helpers import complete_recording, create_recording, put_upload, saved_recording
from .progress_helpers import API, error_code, make_attempt, master, new_profile, twister
from .speak_helpers import SLUG, submit

pytestmark = pytest.mark.django_db


def fire(profile: Profile, kind: str = "attempt", **event) -> set[str]:
    return {u.achievement.code for u in achievements.evaluate(Event(kind, profile, **event))}


def attempt_event(profile: Profile, tw: Twister | None = None, *, previous_best=None, **attempt):
    tw = tw or twister()
    made = make_attempt(profile, tw, **attempt)
    return {"attempt": made, "twister": tw, "previous_best": previous_best}


# --- catalogue ----------------------------------------------------------------------------------------


def test_catalogue_is_consistent_and_fully_implemented():
    codes = [d.code for d in CATALOGUE]
    assert len(codes) == len(set(codes)) == 27
    assert {d.tier for d in CATALOGUE} <= {"bronze", "silver", "gold"}
    assert {d.criteria["type"] for d in CATALOGUE} <= set(achievements.RULES)
    assert len({d.sort_order for d in CATALOGUE}) == 27
    assert all(d.xp_reward > 0 and d.icon and d.description for d in CATALOGUE)


def test_every_rule_type_is_used_by_the_catalogue():
    assert set(achievements.RULES) == {d.criteria["type"] for d in CATALOGUE}


def test_the_seed_migration_matches_the_catalogue_shipped_with_it(seeded):
    rows = {a.code: a for a in Achievement.objects.all()}
    assert set(rows) == {d.code for d in CATALOGUE}
    for d in CATALOGUE:
        row = rows[d.code]
        assert (row.name, row.tier, row.category, row.criteria, row.xp_reward) == (
            d.name,
            d.tier,
            d.category,
            d.criteria,
            d.xp_reward,
        )
        assert row.verified_only is d.verified_only and row.active


def test_rule_registry_refuses_duplicates():
    with pytest.raises(ValueError):
        achievements.rule("streak", events={"attempt"})(lambda *a, **k: None)


# --- rules at their boundaries ----------------------------------------------------------------------------


def test_first_attempt_badges(seeded):
    p = new_profile()
    assert fire(p, **attempt_event(p, kind="train")) >= {"first_word"}
    assert "first_test" not in fire(new_profile(), **attempt_event(p, kind="drill"))
    q = new_profile()
    assert {"first_word", "first_test"} <= fire(q, **attempt_event(q, kind="test"))


def test_flagged_attempts_count_for_nothing(seeded):
    p = new_profile()
    assert fire(p, **attempt_event(p, flagged=True)) == set()


@pytest.mark.parametrize(
    "score,kind,words,unlocks",
    [
        (100, "test", 10, True),
        (99, "test", 10, False),
        (100, "record", 10, True),
        (100, "train", 10, False),  # partial twisters never earn skill badges
        (100, "test", 9, False),
    ],
)
def test_flawless(seeded, score, kind, words, unlocks):
    p = new_profile()
    tw = twister(word_count__gte=10) if words >= 10 else twister(word_count__lt=10)
    assert ("perfect_100" in fire(p, **attempt_event(p, tw, score=score, kind=kind))) is unlocks


@pytest.mark.parametrize(
    "score,difficulty,unlocks", [(80, 4, True), (79, 4, False), (100, 3, False)]
)
def test_insane_clear(seeded, score, difficulty, unlocks):
    p = new_profile()
    event = attempt_event(p, twister(difficulty=difficulty), score=score)
    assert ("insane_clear" in fire(p, **event)) is unlocks


@pytest.mark.parametrize(
    "score,long_twister,unlocks", [(80, True, True), (79, True, False), (100, False, False)]
)
def test_marathoner(seeded, score, long_twister, unlocks):
    p = new_profile()
    tw = twister(word_count__gte=100) if long_twister else twister(word_count__lt=100)
    assert ("marathoner" in fire(p, **attempt_event(p, tw, score=score))) is unlocks


@pytest.mark.parametrize(
    "wpm,accuracy,unlocks",
    [(180, 0.9, True), (179.9, 0.95, False), (200, 0.89, False), (250, 1.0, True)],
)
def test_speed_demon(seeded, wpm, accuracy, unlocks):
    p = new_profile()
    assert ("speed_demon" in fire(p, **attempt_event(p, wpm=wpm, accuracy=accuracy))) is unlocks


@pytest.mark.parametrize(
    "previous,score,unlocks",
    [(50, 75, True), (50, 74, False), (None, 100, False), (0, 25, True), (90, 100, False)],
)
def test_comeback_needs_a_25_point_gain_over_an_existing_best(seeded, previous, score, unlocks):
    p = new_profile()
    event = attempt_event(p, score=score, previous_best=previous)
    assert ("comeback" in fire(p, **event)) is unlocks


def test_comeback_ignores_record_attempts(seeded):
    p = new_profile()
    assert "comeback" not in fire(p, **attempt_event(p, score=90, kind="record", previous_best=10))


@pytest.mark.parametrize(
    "best,code,unlocks",
    [
        (2, "streak_3", False),
        (3, "streak_3", True),
        (13, "streak_14", False),
        (14, "streak_14", True),
        (30, "streak_30", True),
    ],
)
def test_streak_badges_use_the_best_streak(seeded, best, code, unlocks):
    p = new_profile(best_streak=best)
    assert (code in fire(p, "session")) is unlocks


@pytest.mark.parametrize(
    "count,code,unlocks",
    [
        (0, "mastered_1", False),
        (1, "mastered_1", True),
        (9, "mastered_10", False),
        (10, "mastered_10", True),
    ],
)
def test_mastered_count_badges(seeded, count, code, unlocks):
    p = new_profile()
    master(p, list(Twister.objects.order_by("id")[:count]))
    assert (code in fire(p)) is unlocks


@pytest.mark.parametrize("count,unlocks", [(4, False), (5, True)])
def test_category_sweep_needs_five_in_that_family(seeded, count, unlocks):
    p = new_profile()
    master(p, list(Twister.objects.filter(category__slug="hissers")[:count]))
    master(
        p, list(Twister.objects.filter(category__slug="poppers")[:4])
    )  # other families don't add up
    assert ("sweep_hissers" in fire(p)) is unlocks
    assert "sweep_poppers" not in fire(p)


def passing(p: Profile, difficulty: int, score=80, **over):
    return make_attempt(p, twister(difficulty=difficulty), score=score, **over)


def test_ladder_climber_needs_a_passing_test_at_every_level(seeded):
    p = new_profile()
    for level in (1, 2, 3):
        passing(p, level)
    passing(p, 4, score=79)  # close, but not a pass
    assert "all_levels" not in fire(p)
    passing(p, 4, score=80)
    assert "all_levels" in fire(p)


def test_ladder_climber_ignores_flagged_and_non_test_attempts(seeded):
    p = new_profile()
    for level in (1, 2, 3):
        passing(p, level)
    passing(p, 4, flagged=True)
    passing(p, 4, kind="train")
    assert "all_levels" not in fire(p)


@pytest.mark.parametrize("ms,unlocks", [(599_999, False), (600_000, True)])
def test_steady_pacer_sums_read_along_time_across_days(seeded, ms, unlocks):
    p = new_profile()
    DailyActivity.objects.create(
        profile=p, local_date=dt.date(2026, 9, 1), read_along_ms=ms - 100_000
    )
    DailyActivity.objects.create(profile=p, local_date=dt.date(2026, 9, 2), read_along_ms=100_000)
    assert ("read_10min" in fire(p, "session")) is unlocks


def test_explorer_needs_every_category_with_a_published_twister(seeded):
    p = new_profile()
    categories = list(Category.objects.filter(twisters__is_published=True).distinct())
    assert len(categories) == 6
    for c in categories[:5]:
        make_attempt(p, Twister.objects.filter(category=c).first())
    assert "explorer" not in fire(p)
    make_attempt(p, Twister.objects.filter(category=categories[5]).first())
    assert "explorer" in fire(p)


def test_explorer_follows_the_published_catalogue(seeded):
    p = new_profile()
    for c in Category.objects.all():
        make_attempt(p, Twister.objects.filter(category=c).first())
    Twister.objects.filter(category__slug="rollers").update(is_published=False)
    Twister.objects.filter(category__slug="hissers").exclude(
        pk=Twister.objects.filter(category__slug="hissers").first().pk
    ).update(is_published=False)
    assert "explorer" in fire(p)  # a category with nothing published no longer counts


def test_on_camera_needs_a_ready_recording(cloud_user, storage):
    client, profile = cloud_user
    created = create_recording(client)  # reserved, not uploaded: not a saved recording yet
    assert created.status_code == 201
    assert "recorded_1" not in fire(profile, "recording")
    put_upload(storage, created)
    complete_recording(client, created.data["recording"]["id"])
    assert UserAchievement.objects.filter(profile=profile, achievement_id="recorded_1").exists()


def test_a_deleted_recording_does_not_count(cloud_user, storage):
    client, profile = cloud_user
    detail = saved_recording(client, storage)
    client.delete(f"{API}/recordings/{detail['id']}/")
    UserAchievement.objects.filter(profile=profile).delete()  # forget the unlock made on save
    assert "recorded_1" not in fire(profile, "recording")


# --- event subscriptions --------------------------------------------------------------------------------


def test_a_rule_only_runs_for_the_events_it_subscribes_to(seeded):
    p = new_profile()
    make_attempt(p)
    assert fire(p, "session") == set() and fire(p, "recording") == set()
    assert "first_word" in fire(p, "attempt")


# --- idempotence, XP, revocation -------------------------------------------------------------------------


def test_evaluating_twice_grants_each_badge_and_its_xp_once(seeded):
    p = new_profile()
    first = fire(p, **attempt_event(p))
    assert first >= {"first_word", "first_test"}
    xp = Profile.objects.get(pk=p.pk).xp
    assert xp == sum(a.xp_reward for a in Achievement.objects.filter(code__in=first))
    assert fire(p, **attempt_event(p)) - first == set()
    assert Profile.objects.get(pk=p.pk).xp == xp
    assert UserAchievement.objects.filter(profile=p, achievement_id="first_word").count() == 1


def test_unlock_records_progress_for_counters_and_null_for_events(seeded):
    p = new_profile(best_streak=3)
    fire(p, **attempt_event(p, twister(word_count__gte=10), score=100))
    rows = {u.achievement_id: u for u in UserAchievement.objects.filter(profile=p)}
    assert rows["streak_3"].progress == 1.0
    assert rows["perfect_100"].progress is None


def test_a_revoked_badge_is_locked_and_never_regranted(seeded):
    p = new_profile()
    fire(p, **attempt_event(p))
    UserAchievement.objects.filter(profile=p, achievement_id="first_word").update(revoked=True)
    xp = Profile.objects.get(pk=p.pk).xp
    assert "first_word" not in fire(p, **attempt_event(p))
    assert Profile.objects.get(pk=p.pk).xp == xp
    assert UserAchievement.objects.get(profile=p, achievement_id="first_word").revoked is True


def test_inactive_badges_are_not_granted(seeded):
    Achievement.objects.filter(code="first_word").update(active=False)
    p = new_profile()
    assert "first_word" not in fire(p, **attempt_event(p))


# --- trust ---------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "over,provisional,unlocks",
    [
        ({"verification_status": "verified"}, False, True),
        ({"verification_status": "device"}, False, True),
        ({"verification_status": "none"}, True, True),  # provisional results count while allowed
        ({"verification_status": "none"}, False, False),
        ({"verification_status": "failed", "flagged": True}, True, False),
        ({"verification_status": "none", "engine_confidence": 0.3}, True, False),
    ],
)
def test_verified_only_badges_ignore_untrusted_attempts(
    seeded, settings, over, provisional, unlocks
):
    settings.MASTERY_ALLOW_PROVISIONAL = provisional
    p = new_profile()
    tw = twister(word_count__gte=10)
    event = attempt_event(p, tw, score=100, **over)
    assert ("perfect_100" in fire(p, **event)) is unlocks


def test_unverified_attempts_still_count_for_unverified_badges(seeded, settings):
    settings.MASTERY_ALLOW_PROVISIONAL = False
    p = new_profile()
    codes = fire(p, **attempt_event(p, verification_status="none"))
    assert {"first_word", "first_test"} <= codes


def test_ladder_climber_only_counts_trusted_tests(seeded, settings):
    settings.MASTERY_ALLOW_PROVISIONAL = False
    p = new_profile()
    for level in (1, 2, 3, 4):
        passing(p, level, verification_status="none")
    assert "all_levels" not in fire(p)
    passing(p, 4, verification_status="verified")
    assert "all_levels" not in fire(p)  # levels 1-3 are still untrusted
    for level in (1, 2, 3):
        passing(p, level, verification_status="verified")
    assert "all_levels" in fire(p)


# --- robustness ------------------------------------------------------------------------------------------


def test_an_unknown_criteria_type_is_skipped_and_logged(seeded, caplog):
    Achievement.objects.create(
        code="future_rule",
        name="F",
        description="d",
        icon="x",
        tier="gold",
        category="skill",
        criteria={"type": "from_the_future"},
    )
    p = new_profile()
    with caplog.at_level(logging.WARNING, logger="twisters.progress.achievements"):
        codes = fire(p, **attempt_event(p))
    assert "first_word" in codes and "future_rule" not in codes
    assert "future_rule" in caplog.text


def test_an_exploding_rule_never_costs_the_attempt(user, monkeypatch, caplog):
    client, profile = user

    def boom(*_a, **_k):
        raise RuntimeError("rule bug")

    monkeypatch.setitem(achievements.RULES, "attempts", Rule(boom, frozenset({"attempt"})))
    with caplog.at_level(logging.ERROR, logger="twisters.progress.achievements"):
        r = submit(client)
    assert r.status_code == 201 and r.data["achievements_unlocked"] == []
    profile.refresh_from_db()
    assert profile.attempts.count() == 1
    assert profile.xp == r.data["xp_awarded"] == r.data["profile"]["xp"]  # no partial badge XP
    assert not UserAchievement.objects.filter(profile=profile).exists()
    assert "achievement.evaluation_failed" in caplog.text


def test_a_failed_evaluation_heals_on_the_next_event(user, monkeypatch):
    client, profile = user
    good = achievements.RULES["attempts"]
    monkeypatch.setitem(
        achievements.RULES, "attempts", Rule(lambda *a, **k: 1 / 0, frozenset({"attempt"}))
    )
    submit(client)
    monkeypatch.setitem(achievements.RULES, "attempts", good)
    again = submit(client)
    assert "first_word" in {a["code"] for a in again.data["achievements_unlocked"]}


def test_the_kill_switch_stops_evaluation(user):
    from twisters.models import FeatureFlag

    client, profile = user
    FeatureFlag.objects.filter(code="achievements").update(enabled=False)
    r = submit(client)
    assert r.status_code == 201 and r.data["achievements_unlocked"] == []
    assert not UserAchievement.objects.filter(profile=profile).exists()


# --- hooks -------------------------------------------------------------------------------------------------


def test_an_attempt_response_announces_its_unlocks(user):
    client, profile = user
    r = submit(client)
    assert r.status_code == 201
    unlocked = {a["code"]: a for a in r.data["achievements_unlocked"]}
    assert set(unlocked) >= {"first_word", "first_test"}
    assert set(unlocked["first_word"]) == {
        "code",
        "name",
        "description",
        "icon",
        "tier",
        "xp_reward",
    }
    assert (
        unlocked["first_word"]["name"] == "First Words"
        and unlocked["first_word"]["tier"] == "bronze"
    )
    badge_xp = sum(a["xp_reward"] for a in unlocked.values())
    assert r.data["profile"]["xp"] == r.data["xp_awarded"] + badge_xp
    assert Profile.objects.get(pk=profile.pk).xp == r.data["profile"]["xp"]

    second = submit(client)
    assert "first_word" not in {a["code"] for a in second.data["achievements_unlocked"]}


def test_badge_xp_can_level_the_user_up(user):
    client, profile = user
    probe = submit(client)  # learn what this attempt pays, then replay on a fresh profile
    xp, badge_xp = (
        probe.data["xp_awarded"],
        sum(a["xp_reward"] for a in probe.data["achievements_unlocked"]),
    )
    assert badge_xp > 0
    UserAchievement.objects.filter(profile=profile).delete()
    Profile.objects.filter(pk=profile.pk).update(
        xp=200 - xp - 1, last_activity_date=None, current_streak=0
    )
    r = submit(client)
    assert r.data["xp_awarded"] == xp
    assert r.data["level_up"] is True and r.data["profile"]["level"] == 2


def test_unlocks_wait_in_the_summary_until_seen(user):
    client, _ = user
    submit(client)
    unseen = client.get(f"{API}/me/summary/").data["unseen_achievements"]
    assert {"first_word", "first_test"} <= {a["code"] for a in unseen}
    assert set(unseen[0]) == {
        "code",
        "name",
        "description",
        "icon",
        "tier",
        "xp_reward",
        "unlocked_at",
    }

    marked = client.post(
        f"{API}/me/achievements/seen/", {"codes": ["first_word", "nope"]}, format="json"
    )
    assert marked.status_code == 200 and marked.data == {"marked": 1}
    left = {a["code"] for a in client.get(f"{API}/me/summary/").data["unseen_achievements"]}
    assert "first_word" not in left and "first_test" in left

    everything = client.post(f"{API}/me/achievements/seen/", {}, format="json")
    assert everything.data["marked"] == len(left)
    assert client.get(f"{API}/me/summary/").data["unseen_achievements"] == []
    assert client.post(f"{API}/me/achievements/seen/", {}, format="json").data == {"marked": 0}


@pytest.mark.parametrize(
    "body", [{"codes": "first_word"}, {"codes": [1, {}]}, {"codes": ["x"] * 101}]
)
def test_seen_rejects_malformed_bodies(user, body):
    client, _ = user
    r = client.post(f"{API}/me/achievements/seen/", body, format="json")
    assert r.status_code == 400 and error_code(r) == "validation_error"


def test_seen_only_touches_your_own_rows(user, auth_client):
    client, profile = user
    submit(client)
    other = auth_client()
    other.get(f"{API}/me/")
    assert other.post(f"{API}/me/achievements/seen/", {}, format="json").data == {"marked": 0}
    assert UserAchievement.objects.filter(profile=profile, seen=False).exists()


def test_achievement_endpoints_need_a_login(seeded, anon):
    assert anon.get(f"{API}/me/achievements/").status_code == 401
    assert anon.post(f"{API}/me/achievements/seen/", {}, format="json").status_code == 401


def aged(client, session_id, ms):
    from django.utils import timezone

    from twisters.models import PracticeSession

    PracticeSession.objects.filter(pk=session_id).update(
        started_at=timezone.now() - dt.timedelta(milliseconds=ms)
    )


def test_finishing_a_read_along_reports_its_unlocks(user):
    client, _ = user
    body = {"client_session_id": str(uuid.uuid4()), "twister": SLUG, "mode": "read_along"}
    sid = client.post(f"{API}/sessions/", body, format="json").data["id"]
    aged(client, sid, 700_000)

    beat = client.patch(f"{API}/sessions/{sid}/", {"active_ms": 650_000}, format="json")
    assert beat.data["achievements_unlocked"] == []

    done = client.patch(
        f"{API}/sessions/{sid}/",
        {"status": "completed", "passes_completed": 1, "active_ms": 650_000},
        format="json",
    )
    codes = {a["code"] for a in done.data["achievements_unlocked"]}
    assert "read_10min" in codes
    badge_xp = sum(a["xp_reward"] for a in done.data["achievements_unlocked"])
    assert done.data["profile"]["xp"] == done.data["xp_awarded"] + badge_xp

    replay = client.patch(f"{API}/sessions/{sid}/", {"status": "completed"}, format="json")
    assert replay.data["achievements_unlocked"] == []


def test_saving_a_recording_unlocks_quietly(cloud_user, storage):
    client, profile = cloud_user
    detail = saved_recording(client, storage)
    assert "achievements_unlocked" not in detail  # the recording contract is unchanged
    unseen = client.get(f"{API}/me/summary/").data["unseen_achievements"]
    assert "recorded_1" in {a["code"] for a in unseen}
    profile.refresh_from_db()
    assert profile.xp == Achievement.objects.get(code="recorded_1").xp_reward


def test_repeating_complete_does_not_pay_twice(cloud_user, storage):
    client, profile = cloud_user
    detail = saved_recording(client, storage)
    client.post(f"{API}/recordings/{detail['id']}/complete/", {}, format="json")
    profile.refresh_from_db()
    assert profile.xp == Achievement.objects.get(code="recorded_1").xp_reward


def test_guest_imports_unlock_nothing_and_the_next_live_attempt_catches_up(user):
    client, profile = user
    batch = {
        "client_batch_id": str(uuid.uuid4()),
        "attempts": [
            {
                "client_attempt_id": str(uuid.uuid4()),
                "twister": SLUG,
                "transcript": "she sells seashells by the seashore",
                "duration_ms": 4000,
            }
        ],
        "favorites": [],
    }
    r = client.post(f"{API}/sync/guest/", batch, format="json")
    assert r.status_code == 201 and r.data["attempts_imported"] == 1
    assert not UserAchievement.objects.filter(profile=profile).exists()
    profile.refresh_from_db()
    assert profile.xp == 0

    live = submit(client)
    assert {"first_word", "first_test"} <= {a["code"] for a in live.data["achievements_unlocked"]}


# --- the list ------------------------------------------------------------------------------------------------


def test_list_shape_order_and_progress(user):
    client, _ = user
    submit(client)
    body = client.get(f"{API}/me/achievements/").data
    assert body["total"] == 27 and body["unlocked"] >= 2
    results = body["results"]
    assert [r["code"] for r in results][:3] == ["first_word", "first_test", "streak_3"]
    assert set(results[0]) == {
        "code",
        "name",
        "description",
        "icon",
        "tier",
        "category",
        "xp_reward",
        "unlocked_at",
        "progress",
        "seen",
    }
    by = {r["code"]: r for r in results}
    assert by["first_word"]["unlocked_at"] is not None and by["first_word"]["progress"] == 1.0
    assert by["streak_3"]["unlocked_at"] is None and by["streak_3"]["progress"] == pytest.approx(
        1 / 3
    )
    assert by["perfect_100"]["progress"] is None  # event rules have no meter
    assert by["mastered_10"]["progress"] == 0.0
    assert body["unlocked"] == sum(1 for r in results if r["unlocked_at"])


def test_locked_secret_badges_reveal_nothing_until_unlocked(user):
    client, profile = user
    Achievement.objects.filter(code__in=["first_word", "streak_3"]).update(hidden=True)
    by = {r["code"]: r for r in client.get(f"{API}/me/achievements/").data["results"]}
    assert by["streak_3"]["name"] == "Secret achievement"
    assert by["streak_3"]["description"] == "Keep practising to find it."
    assert (by["streak_3"]["icon"], by["streak_3"]["progress"]) == ("lock", None)
    assert by["streak_3"]["code"] == "streak_3" and by["streak_3"]["xp_reward"] == 15

    submit(client)
    by = {r["code"]: r for r in client.get(f"{API}/me/achievements/").data["results"]}
    assert by["first_word"]["name"] == "First Words" and by["first_word"]["icon"] == "mic"


def test_revoked_badges_read_as_locked(user):
    client, profile = user
    submit(client)
    UserAchievement.objects.filter(profile=profile, achievement_id="first_word").update(
        revoked=True
    )
    body = client.get(f"{API}/me/achievements/").data
    row = next(r for r in body["results"] if r["code"] == "first_word")
    assert row["unlocked_at"] is None and row["seen"] is False
    assert client.get(f"{API}/me/summary/").data["achievements"]["unlocked"] == body["unlocked"]


def test_another_users_unlocks_are_invisible(user, auth_client):
    client, _ = user
    submit(client)
    other = auth_client()
    body = other.get(f"{API}/me/achievements/").data
    assert body["unlocked"] == 0 and all(r["unlocked_at"] is None for r in body["results"])


def test_the_list_costs_a_fixed_number_of_queries(user, django_assert_max_num_queries):
    client, profile = user
    submit(client)
    with django_assert_max_num_queries(20):
        assert client.get(f"{API}/me/achievements/").status_code == 200


# --- sync_achievements ------------------------------------------------------------------------------------------


def test_sync_is_idempotent_and_restores_edits(seeded, capsys):
    call_command("sync_achievements")
    Achievement.objects.filter(code="streak_7").update(name="Hacked", xp_reward=999, active=False)
    before = Achievement.objects.count()
    call_command("sync_achievements")
    call_command("sync_achievements")
    assert Achievement.objects.count() == before == 27
    row = Achievement.objects.get(code="streak_7")
    assert (row.name, row.xp_reward, row.active) == ("On Fire", 30, True)
    assert "created=0, updated=27, deactivated=0" in capsys.readouterr().out


def test_sync_deactivates_removed_codes_without_touching_user_rows(seeded):
    p = new_profile()
    legacy = Achievement.objects.create(
        code="retired",
        name="R",
        description="d",
        icon="x",
        tier="gold",
        category="skill",
        criteria={"type": "attempts", "min": 1},
    )
    UserAchievement.objects.create(profile=p, achievement=legacy)
    call_command("sync_achievements")
    legacy.refresh_from_db()
    assert legacy.active is False
    assert UserAchievement.objects.filter(profile=p, achievement_id="retired").count() == 1
    assert "retired" not in {a.code for a in Achievement.objects.filter(active=True)}


def test_sync_creates_missing_rows(seeded):
    Achievement.objects.filter(code="explorer").delete()
    call_command("sync_achievements")
    assert Achievement.objects.filter(code="explorer", active=True).exists()


def test_retired_badges_leave_the_counts(user):
    client, profile = user
    submit(client)
    before = client.get(f"{API}/me/summary/").data["achievements"]
    Achievement.objects.filter(code="first_word").update(active=False)
    after = client.get(f"{API}/me/summary/").data["achievements"]
    assert after == {"unlocked": before["unlocked"] - 1, "total": before["total"] - 1}
