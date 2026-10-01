"""Weekly and per-twister leaderboards: names, eligibility, ranking, privacy, the hourly rebuild."""

import datetime as dt

import pytest
from django.core.management import call_command
from django.db import IntegrityError, transaction

from twisters.models import DailyTwister, FeatureFlag, LeaderboardEntry, Profile, Twister
from twisters.progress import boards, daily

from .progress_helpers import API, at, error_code, freeze_time, make_attempt, new_profile

# Thursday 10 Sep 2026; its week starts Monday 7 Sep.
NOW = at(2026, 9, 10, 12)
MONDAY = dt.date(2026, 9, 7)
LAST_MONDAY = dt.date(2026, 8, 31)


@pytest.fixture
def clock(monkeypatch):
    freeze_time(monkeypatch, NOW)


@pytest.fixture
def board_on(db):
    FeatureFlag.objects.filter(code="weekly_boards").update(enabled=True)


@pytest.fixture
def tw(seeded):
    return Twister.objects.get(slug="peter-piper")


def player(name="", **over) -> Profile:
    return new_profile(public_name=name, **over)


TUESDAY_10AM = at(2026, 9, 8, 10)


def score(profile, tw, value, when=TUESDAY_10AM, **over):
    return make_attempt(profile, tw, score=value, when=when, **over)


# --- names ---------------------------------------------------------------------------------------------


def test_public_name_is_used_when_the_player_opted_in(db):
    assert boards.board_name(player("Tongue Twirler")) == "Tongue Twirler"


def test_everyone_else_is_player_nnnn_and_stable(db):
    p = player()
    name = boards.board_name(p)
    assert name.startswith("Player ") and len(name.split()[1]) == 4 and name.split()[1].isdigit()
    assert boards.board_name(Profile.objects.get(pk=p.pk)) == name
    assert boards.board_name_for(p.pk, "") == name


def test_numbers_vary_between_players(db):
    assert len({boards.board_name(player()) for _ in range(30)}) > 10


def test_a_board_name_never_reveals_the_account(db):
    p = player(display_name="Alice Smith", email="alice.smith@example.com")
    shown = boards.board_name(p)
    assert "alice" not in shown.lower() and "smith" not in shown.lower() and "@" not in shown


def test_week_start_is_the_monday_in_utc():
    assert boards.week_start(at(2026, 9, 7, 0, 0)) == MONDAY
    assert boards.week_start(at(2026, 9, 13, 23, 59)) == MONDAY
    assert boards.week_start(at(2026, 9, 14, 0, 0)) == dt.date(2026, 9, 14)
    kolkata = dt.timezone(dt.timedelta(hours=5, minutes=30))
    assert (
        boards.week_start(dt.datetime(2026, 9, 7, 3, 0, tzinfo=kolkata)) == LAST_MONDAY
    )  # still Sunday in UTC
    assert boards.week_start(dt.date(2026, 9, 9)) == MONDAY


def test_recent_weeks_are_this_and_last():
    assert boards.recent_weeks(NOW) == [MONDAY, LAST_MONDAY]


# --- eligibility ---------------------------------------------------------------------------------------


def eligible(tw):
    return set(boards.eligible_attempts(MONDAY).filter(twister=tw).values_list("id", flat=True))


def test_only_clean_tests_inside_the_week_qualify(tw):
    good = score(player(), tw, 90)
    score(player(), tw, 99, flagged=True)
    score(player(), tw, 99, kind="train")
    score(player(), tw, 99, kind="record")
    score(player(), tw, 99, score_version=1)
    score(
        player(),
        tw,
        99,
        when=at(
            2026,
            9,
            6,
            23,
            59,
        ),
    )  # Sunday before
    score(player(), tw, 99, when=at(2026, 9, 14, 0, 0))  # Monday after
    edge_start = score(player(), tw, 70, when=at(2026, 9, 7, 0, 0))
    edge_end = score(player(), tw, 70, when=at(2026, 9, 13, 23, 59))
    assert eligible(tw) == {good.id, edge_start.id, edge_end.id}


def test_opt_outs_and_minors_never_rank(tw):
    shown = score(player(), tw, 80)
    score(player(hide_from_boards=True), tw, 100)
    score(player(age_band="under13"), tw, 100)
    score(player(age_band="13plus"), tw, 60)
    score(player(age_band="unknown"), tw, 60)
    assert shown.id in eligible(tw) and len(eligible(tw)) == 3


def test_unverified_attempts_drop_out_when_verification_is_required(tw, settings):
    verified = score(player(), tw, 80, verification_status="verified")
    unverified = score(player(), tw, 80, verification_status="device")
    assert eligible(tw) == {verified.id, unverified.id}
    settings.LEADERBOARD_REQUIRE_VERIFIED = True
    assert eligible(tw) == {verified.id}


# --- ranking ---------------------------------------------------------------------------------------------


def ranked(tw, week=MONDAY):
    return [
        (e.profile_id, e.best_score, e.rank)
        for e in LeaderboardEntry.objects.filter(week_start=week, twister=tw).order_by("rank")
    ]


def test_rebuild_ranks_by_best_score_then_earliest_then_profile_id(tw):
    a, b, c, d, e = (player() for _ in range(5))
    score(a, tw, 90, at(2026, 9, 8, 9))
    score(a, tw, 60, at(2026, 9, 8, 8))
    score(b, tw, 90, at(2026, 9, 8, 7))  # same score as a, reached earlier
    score(c, tw, 95, at(2026, 9, 9, 9))
    first, second = sorted([d, e], key=lambda p: p.pk)
    score(d, tw, 70, at(2026, 9, 8, 12))
    score(e, tw, 70, at(2026, 9, 8, 12))  # identical score and instant: profile id decides

    assert boards.rebuild_week(MONDAY, tw) == 5
    assert ranked(tw) == [
        (c.pk, 95, 1),
        (b.pk, 90, 2),
        (a.pk, 90, 3),
        (first.pk, 70, 4),
        (second.pk, 70, 5),
    ]


def test_each_row_keeps_the_attempt_that_earned_it(tw):
    p = player()
    early = score(p, tw, 88, at(2026, 9, 8, 7))
    score(p, tw, 88, at(2026, 9, 9, 7))  # equals the best later: the earlier one is the record
    score(p, tw, 50, at(2026, 9, 8, 1))
    boards.rebuild_week(MONDAY, tw)
    entry = LeaderboardEntry.objects.get(profile=p)
    assert (entry.best_attempt_id, entry.achieved_at, entry.best_score) == (
        early.id,
        early.created_at,
        88,
    )


def test_rebuild_is_idempotent_and_scoped_to_one_board(tw):
    other = Twister.objects.get(slug="she-sells-seashells")
    p = player()
    score(p, tw, 70)
    score(p, other, 55)
    boards.rebuild_week(MONDAY, other)
    before = ranked(other)
    assert boards.rebuild_week(MONDAY, tw) == boards.rebuild_week(MONDAY, tw) == 1
    assert ranked(tw) == [(p.pk, 70, 1)] and ranked(other) == before


def test_rebuild_replaces_stale_rows(tw):
    a, b = player(), player()
    top = score(a, tw, 90)
    score(b, tw, 70)
    boards.rebuild_week(MONDAY, tw)
    assert [r[2] for r in ranked(tw)] == [1, 2]
    type(top).objects.filter(pk=top.pk).update(flagged=True)  # caught cheating after the fact
    Profile.objects.filter(pk=b.pk).update(hide_from_boards=True)
    boards.rebuild_week(MONDAY, tw)
    assert ranked(tw) == []


def test_rebuild_with_no_attempts_clears_the_board(tw):
    p = player()
    LeaderboardEntry.objects.create(
        week_start=MONDAY, twister=tw, profile=p, best_score=50, achieved_at=NOW, rank=1
    )
    assert boards.rebuild_week(MONDAY, tw) == 0
    assert not LeaderboardEntry.objects.exists()


def test_deleting_a_profile_removes_its_rows(tw):
    p, keeper = player(), player()
    score(p, tw, 90)
    score(keeper, tw, 80)
    boards.rebuild_week(MONDAY, tw)
    p.delete()
    assert ranked(tw) == [(keeper.pk, 80, 2)]


def test_entry_constraints_are_enforced_by_the_database(tw):
    p = player()
    base = {"week_start": MONDAY, "twister": tw, "profile": p, "achieved_at": NOW}
    for bad in ({"best_score": 101, "rank": 1}, {"best_score": 50, "rank": 0}):
        with pytest.raises(IntegrityError), transaction.atomic():
            LeaderboardEntry.objects.create(**base, **bad)
    LeaderboardEntry.objects.create(**base, best_score=50, rank=1)
    with pytest.raises(IntegrityError), transaction.atomic():
        LeaderboardEntry.objects.create(**base, best_score=60, rank=2)


# --- the weekly endpoint ---------------------------------------------------------------------------------


def weekly(client, **params):
    return client.get(f"{API}/leaderboard/weekly/", params)


def test_flag_off_is_a_403(tw, anon, clock):
    r = weekly(anon, twister=tw.slug)
    assert r.status_code == 403 and error_code(r) == "feature_disabled"


def test_under_13_viewers_are_turned_away(user, board_on, clock):
    client, profile = user
    Profile.objects.filter(pk=profile.pk).update(age_band="under13")
    r = weekly(client)
    assert r.status_code == 403 and error_code(r) == "minor_not_allowed"


def test_the_board_shape(board_on, clock, tw, anon):
    p = player("Tongue Twirler", avatar_emoji="🐍")
    score(p, tw, 96, at(2026, 9, 8, 10))
    boards.rebuild_week(MONDAY, tw)
    r = weekly(anon, twister=tw.slug)
    assert r.status_code == 200
    body = r.data
    assert set(body) == {"week_start", "week_end", "twister", "top", "me", "hidden", "updated_at"}
    assert (body["week_start"], body["week_end"]) == ("2026-09-07", "2026-09-13")
    assert body["twister"] == {"slug": tw.slug, "text": tw.text}
    assert body["top"] == [
        {
            "rank": 1,
            "name": "Tongue Twirler",
            "emoji": "🐍",
            "score": 96,
            "achieved_at": at(2026, 9, 8, 10),
            "is_me": False,
        }
    ]
    assert body["me"] is None and body["hidden"] is False and body["updated_at"] is not None
    assert r.headers["Cache-Control"] == "public, max-age=60"


def test_an_empty_board(board_on, clock, tw, anon):
    body = weekly(anon, twister=tw.slug).data
    assert (body["top"], body["me"], body["updated_at"]) == ([], None, None)


def test_the_twister_defaults_to_todays_daily(seeded, board_on, clock, anon):
    body = weekly(anon).data
    assert body["twister"]["slug"] == daily.daily_twister(dt.date(2026, 9, 10)).twister.slug


def test_unknown_or_unpublished_twisters_are_404(board_on, clock, anon, tw):
    assert weekly(anon, twister="nope").status_code == 404
    Twister.objects.filter(pk=tw.pk).update(is_published=False)
    assert weekly(anon, twister=tw.slug).status_code == 404


def test_the_board_reads_only_stored_rows(board_on, clock, tw, anon):
    score(player(), tw, 99)
    assert (
        weekly(anon, twister=tw.slug).data["top"] == []
    )  # nothing rebuilt yet: no live aggregation
    boards.rebuild_week(MONDAY, tw)
    assert len(weekly(anon, twister=tw.slug).data["top"]) == 1


def test_top_is_capped_and_me_is_shown_outside_it(board_on, clock, tw, user, settings):
    settings.LEADERBOARD_TOP_N = 3
    client, me = user
    for value in (99, 98, 97, 96):
        score(player(), tw, value)
    score(me, tw, 81)
    boards.rebuild_week(MONDAY, tw)
    body = weekly(client, twister=tw.slug).data
    assert [e["rank"] for e in body["top"]] == [1, 2, 3] and not any(
        e["is_me"] for e in body["top"]
    )
    assert body["me"] == {"rank": 5, "score": 81}


def test_is_me_marks_the_viewers_own_row(board_on, clock, tw, user):
    client, me = user
    score(me, tw, 90)
    score(player(), tw, 80)
    boards.rebuild_week(MONDAY, tw)
    body = weekly(client, twister=tw.slug).data
    assert [e["is_me"] for e in body["top"]] == [True, False] and body["me"] == {
        "rank": 1,
        "score": 90,
    }
    assert body["top"][0]["name"] == boards.board_name(me)
    assert weekly(client, twister=tw.slug).headers["Cache-Control"] == "private, max-age=60"


def test_opting_out_hides_you_at_once_without_a_rebuild(board_on, clock, tw, user):
    client, me = user
    score(me, tw, 90)
    score(player(), tw, 80)
    boards.rebuild_week(MONDAY, tw)
    assert len(weekly(client, twister=tw.slug).data["top"]) == 2
    assert (
        client.patch(f"{API}/me/", {"hide_from_boards": True}, format="json").data[
            "hide_from_boards"
        ]
        is True
    )
    body = weekly(client, twister=tw.slug).data
    assert body["hidden"] is True and body["me"] is None
    assert [e["score"] for e in body["top"]] == [80]
    anon_view = weekly(client.__class__(), twister=tw.slug).data
    assert [e["score"] for e in anon_view["top"]] == [80]


def test_minors_already_on_a_stored_board_disappear_from_it(board_on, clock, tw, anon):
    kid = player(age_band="under13")
    LeaderboardEntry.objects.create(
        week_start=MONDAY, twister=tw, profile=kid, best_score=100, achieved_at=NOW, rank=1
    )
    assert weekly(anon, twister=tw.slug).data["top"] == []


def test_last_weeks_rows_are_not_this_weeks_board(board_on, clock, tw, anon):
    p = player()
    LeaderboardEntry.objects.create(
        week_start=LAST_MONDAY, twister=tw, profile=p, best_score=90, achieved_at=NOW, rank=1
    )
    assert weekly(anon, twister=tw.slug).data["top"] == []


# --- the per-twister board (shape unchanged, names fixed) ---------------------------------------------------


def old_board(client, tw):
    return client.get(f"{API}/twisters/{tw.slug}/leaderboard/")


def test_the_old_board_uses_board_names(tw, anon):
    named = player("Tongue Twirler", display_name="Real Name", avatar_emoji="🐍")
    anonymous = player(display_name="Bob Jones")
    score(named, tw, 90)
    score(anonymous, tw, 80)
    r = old_board(anon, tw)
    assert r.data == [
        {"user": "Tongue Twirler", "emoji": "🐍", "score": 90},
        {"user": boards.board_name(anonymous), "emoji": "🗣️", "score": 80},
    ]
    assert "Bob" not in str(r.data) and "Real Name" not in str(r.data)


def test_the_old_board_skips_opt_outs_and_minors(tw, anon):
    score(player(hide_from_boards=True), tw, 100)
    score(player(age_band="under13"), tw, 100)
    score(player(), tw, 70)
    assert [row["score"] for row in old_board(anon, tw).data] == [70]


def test_the_old_board_keeps_its_ten_row_cap_and_best_per_person(tw, anon, settings):
    for value in range(60, 75):
        score(player(), tw, value)
    twice = player()
    score(twice, tw, 10)
    score(twice, tw, 99)
    rows = old_board(anon, tw).data
    assert len(rows) == 10 and rows[0]["score"] == 99
    assert sum(1 for r in rows if r["user"] == boards.board_name(twice)) == 1


# --- the job -----------------------------------------------------------------------------------------------------


def test_the_command_builds_boards_for_the_weeks_featured_twisters(seeded, clock, capsys):
    featured = daily.daily_twister(dt.date(2026, 9, 10)).twister
    winner = player("Tongue Twirler")
    score(winner, featured, 91, at(2026, 9, 9, 10))
    last_week = player()
    last_weeks_twister = daily.daily_twister(dt.date(2026, 9, 2)).twister
    score(last_week, last_weeks_twister, 85, at(2026, 9, 2, 10))  # last week is kept fresh too
    call_command("build_leaderboard")
    assert "boards=" in capsys.readouterr().out
    assert ranked(featured, MONDAY) == [(winner.pk, 91, 1)]
    last = {
        e.profile_id
        for e in LeaderboardEntry.objects.filter(week_start=LAST_MONDAY, twister=last_weeks_twister)
    }
    assert last == {last_week.pk}


def test_the_command_materialises_every_day_so_unopened_days_still_get_boards(seeded, clock):
    call_command("build_leaderboard")
    days = set(dt.date(2026, 8, 31) + dt.timedelta(days=i) for i in range(11))  # 31 Aug .. 10 Sep
    assert set(DailyTwister.objects.values_list("day", flat=True)) == days


def test_the_command_is_safe_to_rerun(seeded, clock):
    featured = daily.daily_twister(dt.date(2026, 9, 10)).twister
    score(player(), featured, 70, at(2026, 9, 9, 10))
    call_command("build_leaderboard")
    call_command("build_leaderboard")
    assert LeaderboardEntry.objects.filter(week_start=MONDAY, twister=featured).count() == 1


def test_the_command_copes_with_an_empty_catalogue(db, clock):
    Twister.objects.all().delete()
    call_command("build_leaderboard")
    assert not LeaderboardEntry.objects.exists()


# --- the profile fields behind them ----------------------------------------------------------------------------


def test_profile_exposes_the_board_optout_and_freezes(user):
    client, profile = user
    me = client.get(f"{API}/me/").data
    assert (me["hide_from_boards"], me["streak_freezes"]) == (False, 0)
    r = client.patch(f"{API}/me/", {"hide_from_boards": True, "streak_freezes": 2}, format="json")
    assert r.status_code == 200 and r.data["hide_from_boards"] is True
    profile.refresh_from_db()
    assert (profile.hide_from_boards, profile.streak_freezes) == (
        True,
        0,
    )  # freezes are earned, never set
    assert (
        client.patch(f"{API}/me/", {"hide_from_boards": "maybe"}, format="json").status_code == 400
    )
