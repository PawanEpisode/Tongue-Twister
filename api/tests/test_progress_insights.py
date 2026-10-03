"""`/me/summary/`, `/me/stats/` and `/me/activity/`: shapes, local-day bucketing, hand-checked numbers."""

import datetime as dt

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from twisters.models import DailyActivity, Profile, Twister, UserWordStat

from .progress_helpers import (
    API,
    at,
    error_code,
    freeze_time,
    make_attempt,
    master,
    new_profile,
    twister,
)

NOW = at(2026, 9, 10, 12, 0)


@pytest.fixture
def clock(monkeypatch):
    freeze_time(monkeypatch, NOW)


def get(client, path, **params):
    return client.get(f"{API}{path}", params)


# --- summary -------------------------------------------------------------------------------------


def test_summary_of_an_empty_account(user, clock):
    client, _ = user
    r = get(client, "/me/summary/")
    assert r.status_code == 200
    assert r.data == {
        "mastered": 0,
        "total": 205,
        "current_streak": 0,
        "best_streak": 0,
        "streak_at_risk": False,
        "streak_freezes": 0,
        "next_streak_milestone": 3,
        "practised_today": False,
        "achievements": {"unlocked": 0, "total": 27},
        "xp": 0,
        "level": 1,
        "xp_in_level": 0,
        "xp_for_next_level": 200,
        "timezone": "UTC",
        "night_owl": False,
        "deletion_scheduled_for": None,
        "today": "2026-09-10",
        "unseen_achievements": [],
        "daily_goal": {"target": 0, "done": 0, "met": False},
    }
    assert r.headers["Cache-Control"] == "private, no-store"


def test_summary_of_an_active_account(user, monkeypatch):
    client, profile = user
    freeze_time(monkeypatch, at(2026, 9, 10, 19, 0))
    Profile.objects.filter(pk=profile.pk).update(
        xp=420,
        current_streak=4,
        best_streak=6,
        last_activity_date=dt.date(2026, 9, 9),
        streak_freezes=1,
    )
    master(profile, list(Twister.objects.all()[:2]))
    Twister.objects.filter(pk__in=list(Twister.objects.values_list("pk", flat=True)[:1])).update(
        is_published=False
    )

    body = get(client, "/me/summary/").data
    assert (body["mastered"], body["total"]) == (1, 204)  # unpublished twisters leave both numbers
    assert (body["current_streak"], body["best_streak"], body["streak_freezes"]) == (4, 6, 1)
    assert (body["streak_at_risk"], body["practised_today"], body["next_streak_milestone"]) == (
        True,
        False,
        7,
    )
    assert (body["xp"], body["level"], body["xp_in_level"], body["xp_for_next_level"]) == (
        420,
        3,
        20,
        200,
    )


def test_a_practised_day_is_not_at_risk(user, monkeypatch):
    client, profile = user
    freeze_time(monkeypatch, at(2026, 9, 10, 22, 0))
    Profile.objects.filter(pk=profile.pk).update(
        current_streak=4, best_streak=4, last_activity_date=dt.date(2026, 9, 10)
    )
    body = get(client, "/me/summary/").data
    assert (body["practised_today"], body["streak_at_risk"], body["current_streak"]) == (
        True,
        False,
        4,
    )


@pytest.mark.parametrize(
    "last,freezes,shown",
    [
        (dt.date(2026, 9, 9), 0, 4),
        (dt.date(2026, 9, 8), 0, 0),
        (dt.date(2026, 9, 8), 1, 4),
        (dt.date(2026, 9, 7), 2, 0),
    ],
)
def test_a_lapsed_streak_reads_zero_but_is_not_rewritten(user, clock, last, freezes, shown):
    client, profile = user
    Profile.objects.filter(pk=profile.pk).update(
        current_streak=4, best_streak=9, last_activity_date=last, streak_freezes=freezes
    )
    body = get(client, "/me/summary/").data
    assert body["current_streak"] == shown and body["best_streak"] == 9
    assert body["next_streak_milestone"] == (7 if shown else 3)
    assert Profile.objects.get(pk=profile.pk).current_streak == 4


def test_today_is_the_profiles_local_day(user, monkeypatch):
    client, profile = user
    Profile.objects.filter(pk=profile.pk).update(timezone_confirmed=True, timezone="Asia/Kolkata")
    freeze_time(monkeypatch, at(2026, 9, 10, 20, 0))  # 01:30 on the 11th in Kolkata
    assert get(client, "/me/summary/").data["today"] == "2026-09-11"


def test_summary_query_budget(user, clock, django_assert_max_num_queries):
    client, profile = user
    master(profile, list(Twister.objects.all()[:3]))
    with django_assert_max_num_queries(8):
        assert get(client, "/me/summary/").status_code == 200


def test_summary_needs_a_login(seeded, anon):
    assert get(anon, "/me/summary/").status_code == 401


def test_summaries_are_per_user(user, auth_client, clock):
    client, profile = user
    master(profile, list(Twister.objects.all()[:3]))
    other = auth_client()
    assert get(other, "/me/summary/").data["mastered"] == 0


# --- stats: numbers checked by hand ----------------------------------------------------------------


@pytest.fixture
def stats_user(user, clock):
    """Kolkata user (UTC+5:30) whose attempts straddle local midnight.

    5 Sep local: three tests at 60 (23:30 local) -- 6 Sep local: a 100 (00:30 local, the same UTC day)
    7 Sep local: a record at 80, a train (10, partial), a legacy-version test (5) and a flagged one.
    """
    client, profile = user
    Profile.objects.filter(pk=profile.pk).update(
        timezone_confirmed=True, timezone="Asia/Kolkata", xp=420, best_streak=6
    )
    tw = twister(category__slug="hissers")
    for second in range(3):
        make_attempt(
            profile,
            tw,
            score=60,
            accuracy=0.6,
            wpm=100,
            duration_ms=4000,
            when=at(2026, 9, 5, 18, 0) + dt.timedelta(seconds=second),
        )
    make_attempt(
        profile, tw, score=100, accuracy=1.0, wpm=200, duration_ms=5000, when=at(2026, 9, 5, 19, 0)
    )
    make_attempt(
        profile,
        tw,
        kind="record",
        score=80,
        accuracy=0.8,
        wpm=120,
        duration_ms=6000,
        when=at(2026, 9, 7, 8, 0),
    )
    make_attempt(
        profile,
        tw,
        kind="train",
        score=10,
        accuracy=0.1,
        wpm=50,
        duration_ms=1000,
        when=at(2026, 9, 7, 9, 0),
    )
    make_attempt(
        profile,
        tw,
        score=5,
        score_version=1,
        accuracy=0.05,
        wpm=10,
        duration_ms=2000,
        when=at(2026, 9, 7, 10, 0),
    )
    make_attempt(profile, tw, score=0, flagged=True, duration_ms=9000, when=at(2026, 9, 7, 11, 0))
    make_attempt(profile, tw, score=90, when=at(2026, 8, 1, 12, 0), duration_ms=3000)  # outside 7d
    DailyActivity.objects.create(
        profile=profile, local_date=dt.date(2026, 9, 6), read_along_ms=30_000, read_along_passes=1
    )
    return client, profile


def test_stats_for_all_modes_with_local_days(stats_user):
    client, _ = stats_user
    body = get(client, "/me/stats/", range="7d").data
    assert (body["range"], body["mode"], body["from"], body["to"]) == (
        "7d",
        None,
        "2026-09-04",
        "2026-09-10",
    )
    assert body["kpis"] == {
        "attempts": 7,  # 3 + 1 + (record, train, legacy test); the flagged attempt is not counted
        "practice_ms": 56_000,  # 12000 + 5000 + 9000 of attempts + 30000 of Read-along
        "avg_score": 72.0,  # (60*3 + 100 + 80) / 5
        "best_streak": 6,
        "mastered": 0,
        "xp": 420,
        "level": 3,
    }
    assert body["score_series"] == [
        {"date": "2026-09-05", "avg": 60.0, "rolling": 60.0, "count": 3},
        {
            "date": "2026-09-06",
            "avg": 100.0,
            "rolling": 70.0,
            "count": 1,
        },  # (180 + 100) / 4, not (60 + 100) / 2
        {"date": "2026-09-07", "avg": 80.0, "rolling": 72.0, "count": 1},  # 360 / 5
    ]
    assert body["speed_series"] == [
        {"date": "2026-09-05", "avg_wpm": 100.0},
        {"date": "2026-09-06", "avg_wpm": 200.0},
        {"date": "2026-09-07", "avg_wpm": 120.0},
    ]
    assert body["attempts_by_day"] == [
        {"date": "2026-09-05", "attempts": 3, "active_ms": 12_000},
        {"date": "2026-09-06", "attempts": 1, "active_ms": 35_000},  # 5000 + the Read-along row
        {"date": "2026-09-07", "attempts": 3, "active_ms": 9_000},
    ]
    assert body["category_accuracy"] == [
        {"category": "hissers", "name": "Hissers", "avg_accuracy": 0.72, "attempts": 5}
    ]
    assert body["weak_words"] == []


def test_speak_score_mode_counts_practice_but_scores_only_tests(stats_user):
    client, _ = stats_user
    body = get(client, "/me/stats/", range="7d", mode="speak_score").data
    assert body["mode"] == "speak_score"
    assert body["kpis"]["attempts"] == 6  # the record take is out; train and the legacy test are in
    assert body["kpis"]["avg_score"] == 70.0  # (60*3 + 100) / 4
    assert body["kpis"]["practice_ms"] == 26_000 - 6_000  # no Read-along, no record
    assert [p["date"] for p in body["score_series"]] == ["2026-09-05", "2026-09-06"]


def test_record_mode(stats_user):
    client, _ = stats_user
    body = get(client, "/me/stats/", range="7d", mode="record").data
    assert body["kpis"]["attempts"] == 1 and body["kpis"]["avg_score"] == 80.0
    assert body["score_series"] == [
        {"date": "2026-09-07", "avg": 80.0, "rolling": 80.0, "count": 1}
    ]
    assert body["attempts_by_day"] == [{"date": "2026-09-07", "attempts": 1, "active_ms": 6000}]


def test_read_along_mode_has_no_scores_and_reports_read_along_time(stats_user):
    client, _ = stats_user
    body = get(client, "/me/stats/", range="7d", mode="read_along").data
    assert (
        body["score_series"] == []
        and body["speed_series"] == []
        and body["category_accuracy"] == []
    )
    assert body["kpis"]["avg_score"] is None
    assert body["kpis"]["practice_ms"] == 30_000
    assert body["attempts_by_day"] == [{"date": "2026-09-06", "attempts": 1, "active_ms": 30_000}]


def test_ranges_and_the_all_window(stats_user):
    client, _ = stats_user
    thirty = get(client, "/me/stats/", range="30d").data
    assert (thirty["from"], thirty["to"]) == ("2026-08-12", "2026-09-10")
    assert thirty["kpis"]["attempts"] == 7  # the 1 August attempt is still older than 30 days
    everything = get(client, "/me/stats/", range="all").data
    assert everything["from"] == "2026-08-01" and everything["kpis"]["attempts"] == 8
    assert get(client, "/me/stats/").data["range"] == "30d"  # the default


def test_the_all_window_starts_at_the_first_read_along_day_when_earlier(user, clock):
    client, profile = user
    DailyActivity.objects.create(
        profile=profile, local_date=dt.date(2026, 6, 1), read_along_ms=1000
    )
    make_attempt(profile, when=at(2026, 9, 1))
    assert get(client, "/me/stats/", range="all").data["from"] == "2026-06-01"


def test_an_empty_account_gets_empty_series_not_errors(user, clock):
    client, _ = user
    for params in ({}, {"range": "all"}, {"mode": "read_along"}):
        body = get(client, "/me/stats/", **params).data
        assert body["kpis"]["attempts"] == 0 and body["kpis"]["avg_score"] is None
        assert body["score_series"] == body["speed_series"] == body["attempts_by_day"] == []
        assert body["category_accuracy"] == [] and body["weak_words"] == []
    assert get(client, "/me/stats/", range="all").data["from"] == "2026-09-10"


@pytest.mark.parametrize(
    "params", [{"range": "1y"}, {"range": "7"}, {"mode": "karaoke"}, {"mode": "Record"}]
)
def test_bad_range_or_mode_is_a_validation_error(user, clock, params):
    client, _ = user
    r = get(client, "/me/stats/", **params)
    assert r.status_code == 400 and error_code(r) == "validation_error"


def test_long_ranges_are_bucketed_by_iso_week(user, clock, settings):
    client, profile = user
    settings.STATS_MAX_POINTS = 5
    for day in range(1, 11):  # 1 Sep (Tue) .. 10 Sep (Thu)
        make_attempt(profile, twister(), score=day * 5, when=at(2026, 9, day, 10))
    body = get(client, "/me/stats/", range="all").data
    assert [p["date"] for p in body["attempts_by_day"]] == ["2026-08-31", "2026-09-07"]
    assert [p["attempts"] for p in body["attempts_by_day"]] == [6, 4]
    first, second = body["score_series"]
    assert (first["count"], first["avg"]) == (6, 17.5)  # (5 + 10 + .. + 30) / 6
    assert (second["count"], second["avg"]) == (4, 42.5)  # (35 + 40 + 45 + 50) / 4
    assert body["kpis"]["attempts"] == 10


def test_bucketed_series_never_exceed_the_cap(user, clock, settings):
    client, profile = user
    settings.STATS_MAX_POINTS = 2
    for month, day in ((8, 18), (8, 25), (9, 8)):  # three different ISO weeks
        make_attempt(profile, twister(), score=50, when=at(2026, month, day, 10))
    body = get(client, "/me/stats/", range="all").data
    assert [p["date"] for p in body["score_series"]] == ["2026-08-24", "2026-09-07"]


def test_ranges_within_the_cap_keep_daily_points(user, clock, settings):
    client, profile = user
    settings.STATS_MAX_POINTS = 7
    for day in (2, 3, 9):
        make_attempt(profile, twister(), when=at(2026, 9, day, 10))
    body = get(client, "/me/stats/", range="7d").data
    assert [p["date"] for p in body["attempts_by_day"]] == [
        "2026-09-09"
    ]  # 4..10 Sep: the old two are out
    wide = get(client, "/me/stats/", range="30d").data
    assert [p["date"] for p in wide["attempts_by_day"]] == [
        "2026-08-31",
        "2026-09-07",
    ]  # 30 > 7: weekly


def test_weak_words_reuse_the_practice_queue(user, clock):
    client, profile = user
    for word, wrong in [("pickled", 8), ("peppers", 3), ("picked", 0)]:
        UserWordStat.objects.create(
            profile=profile,
            word_norm=word,
            seen=10,
            wrong=wrong,
            weakness=wrong / 10 if wrong else 0,
        )
    body = get(client, "/me/stats/").data["weak_words"]
    queue = client.get(f"{API}/me/words/weak/").data["results"]
    assert [w["word"] for w in body] == [w["word"] for w in queue] == ["pickled", "peppers"]
    assert body[0].keys() == {"word", "miss_rate", "seen", "drill"}
    assert (body[0]["miss_rate"], body[0]["seen"]) == (0.8, 10)
    assert body[0]["drill"] == queue[0]["drill"]


def test_weak_words_are_capped_at_ten(user, clock):
    client, profile = user
    for i in range(12):
        UserWordStat.objects.create(
            profile=profile, word_norm=f"w{i:02d}", seen=5, wrong=1, weakness=0.5
        )
    assert len(get(client, "/me/stats/").data["weak_words"]) == 10


def test_stats_never_leak_other_users_data(stats_user, auth_client):
    client, _ = stats_user
    mine = get(client, "/me/stats/", range="all").data
    intruder = new_profile()
    for day in range(1, 10):
        make_attempt(intruder, twister(), score=99, when=at(2026, 9, day, 10))
        DailyActivity.objects.create(
            profile=intruder, local_date=dt.date(2026, 9, day), read_along_ms=999
        )
    UserWordStat.objects.create(profile=intruder, word_norm="secret", seen=9, wrong=9, weakness=1)
    assert get(client, "/me/stats/", range="all").data == mine
    assert get(auth_client(), "/me/stats/").data["kpis"]["attempts"] == 0


def test_stats_cost_the_same_queries_however_many_attempts(user, clock):
    client, profile = user

    def measure():
        with CaptureQueriesContext(connection) as ctx:
            assert get(client, "/me/stats/", range="all").status_code == 200
        return len(ctx)

    make_attempt(profile, when=at(2026, 9, 9))
    few = measure()
    for day in range(1, 9):
        for _ in range(4):
            make_attempt(profile, twister(), when=at(2026, 9, day, 10))
    assert measure() == few


def test_stats_need_a_login(seeded, anon):
    assert get(anon, "/me/stats/").status_code == 401


# --- activity -----------------------------------------------------------------------------------


def test_activity_lists_only_days_with_rows_oldest_first(user, clock):
    client, profile = user
    days = {
        dt.date(2026, 8, 30): {},  # the Sunday before the window
        dt.date(2026, 8, 31): {"attempts": 2, "active_ms": 500},
        dt.date(2026, 9, 8): {"freeze_used": True},
        dt.date(2026, 9, 10): {"attempts": 1, "read_along_ms": 40_000, "qualifies_streak": True},
        dt.date(2026, 9, 11): {"attempts": 9},  # tomorrow (clock skew / travel): not listed
    }
    for day, fields in days.items():
        DailyActivity.objects.create(profile=profile, local_date=day, **fields)
    DailyActivity.objects.create(profile=new_profile(), local_date=dt.date(2026, 9, 9), attempts=50)

    body = get(client, "/me/activity/", weeks=2).data
    assert (body["from"], body["to"]) == ("2026-08-31", "2026-09-10")  # whole Monday-first weeks
    assert body["days"] == [
        {
            "date": "2026-08-31",
            "attempts": 2,
            "active_ms": 500,
            "read_along_ms": 0,
            "qualifies_streak": False,
            "freeze_used": False,
        },
        {
            "date": "2026-09-08",
            "attempts": 0,
            "active_ms": 0,
            "read_along_ms": 0,
            "qualifies_streak": False,
            "freeze_used": True,
        },
        {
            "date": "2026-09-10",
            "attempts": 1,
            "active_ms": 0,
            "read_along_ms": 40_000,
            "qualifies_streak": True,
            "freeze_used": False,
        },
    ]


def test_activity_defaults_to_twelve_weeks(user, clock):
    client, _ = user
    body = get(client, "/me/activity/").data
    assert (body["from"], body["to"], body["days"]) == ("2026-06-22", "2026-09-10", [])
    assert dt.date.fromisoformat(body["from"]).weekday() == 0


@pytest.mark.parametrize("weeks", ["0", "53", "-1", "abc", "2.5"])
def test_activity_weeks_are_bounded(user, clock, weeks):
    client, _ = user
    r = get(client, "/me/activity/", weeks=weeks)
    assert r.status_code == 400 and error_code(r) == "validation_error"


def test_activity_accepts_the_bounds(user, clock):
    client, _ = user
    assert get(client, "/me/activity/", weeks=1).data["from"] == "2026-09-07"
    assert get(client, "/me/activity/", weeks=52).status_code == 200


def test_activity_needs_a_login(seeded, anon):
    assert get(anon, "/me/activity/").status_code == 401
