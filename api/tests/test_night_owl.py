"""Night owl mode (D23) and the clock-based achievements: the streak-day boundary lives in
`localtime` only, and Night Owl / Early Bird read the real wall clock."""

import datetime as dt
import re
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from twisters import localtime
from twisters.models import Achievement, DailyActivity, FeatureFlag, Profile, UserTwisterStats
from twisters.practice import services
from twisters.progress import achievements, insights, streaks, summary
from twisters.progress.achievements import Event
from twisters.speak import stats

from .progress_helpers import API, make_attempt, new_profile, twister

pytestmark = pytest.mark.django_db
KOLKATA = ZoneInfo("Asia/Kolkata")
NEW_YORK = ZoneInfo("America/New_York")


def local(tz: ZoneInfo, year, month, day, hour=12, minute=0) -> dt.datetime:
    """An instant given on a wall clock (converted to UTC, as `timezone.now()` would give it)."""
    return dt.datetime(year, month, day, hour, minute, tzinfo=tz).astimezone(dt.UTC)


def owl(**over) -> Profile:
    return new_profile(timezone="Asia/Kolkata", night_owl=True, **over)


# --- the boundary --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "hour,minute,expected",
    [(0, 0, 1), (1, 30, 1), (2, 59, 1), (3, 0, 2), (3, 30, 2), (23, 59, 2)],
)
def test_night_owl_moves_the_day_boundary_to_the_cutoff(hour, minute, expected):
    moment = local(KOLKATA, 2026, 9, 2, hour, minute)
    assert localtime.local_date(owl(), moment) == dt.date(2026, 9, expected)


def test_everyone_else_keeps_midnight():
    plain = new_profile(timezone="Asia/Kolkata")
    assert localtime.local_date(plain, local(KOLKATA, 2026, 9, 2, 1, 30)) == dt.date(2026, 9, 2)


def test_the_cutoff_is_a_setting(settings):
    settings.NIGHT_OWL_CUTOFF_HOUR = 5
    assert localtime.local_date(owl(), local(KOLKATA, 2026, 9, 2, 4, 59)) == dt.date(2026, 9, 1)
    assert localtime.local_date(owl(), local(KOLKATA, 2026, 9, 2, 5, 0)) == dt.date(2026, 9, 2)


def test_the_wall_clock_is_not_shifted():
    moment = local(KOLKATA, 2026, 9, 2, 1, 30)
    assert localtime.local_hour(owl(), moment) == 1
    assert localtime.local_now(owl(), moment).date() == dt.date(2026, 9, 2)


def test_day_bounds_start_at_the_cutoff():
    start, end = localtime.day_bounds(owl(), dt.date(2026, 9, 1), dt.date(2026, 9, 2))
    assert start == local(KOLKATA, 2026, 9, 1, 3, 0)
    assert end == local(KOLKATA, 2026, 9, 3, 3, 0)
    plain_start, _ = localtime.day_bounds(
        new_profile(timezone="Asia/Kolkata"), dt.date(2026, 9, 1), dt.date(2026, 9, 1)
    )
    assert plain_start == local(KOLKATA, 2026, 9, 1, 0, 0)


def test_local_date_is_exact_across_a_dst_change():
    """New York springs forward on 2026-03-08 (02:00 becomes 03:00). The wall clock rule still puts
    01:59 EST on the 7th and 03:00 EDT on the 8th, whatever the elapsed hours."""
    profile = new_profile(timezone="America/New_York", night_owl=True)
    before = dt.datetime(2026, 3, 8, 6, 59, tzinfo=dt.UTC)  # 01:59 EST
    after = dt.datetime(2026, 3, 8, 7, 0, tzinfo=dt.UTC)  # 03:00 EDT
    assert localtime.local_date(profile, before) == dt.date(2026, 3, 7)
    assert localtime.local_date(profile, after) == dt.date(2026, 3, 8)


# --- streaks, activity, summary ------------------------------------------------------------------------


def test_an_attempt_at_0130_counts_for_the_previous_day():
    p = owl()
    services.record_attempt(p, 10, local(KOLKATA, 2026, 9, 1, 21, 0))
    services.record_attempt(p, 10, local(KOLKATA, 2026, 9, 2, 1, 30))
    assert p.current_streak == 1
    day = DailyActivity.objects.get(profile=p)
    assert (day.local_date, day.attempts) == (dt.date(2026, 9, 1), 2)


def test_an_attempt_at_0330_starts_the_next_day():
    p = owl()
    services.record_attempt(p, 10, local(KOLKATA, 2026, 9, 1, 21, 0))
    services.record_attempt(p, 10, local(KOLKATA, 2026, 9, 2, 3, 30))
    assert p.current_streak == 2
    assert DailyActivity.objects.filter(profile=p).count() == 2


def test_without_the_mode_the_same_two_attempts_are_two_days():
    p = new_profile(timezone="Asia/Kolkata")
    services.record_attempt(p, 10, local(KOLKATA, 2026, 9, 1, 21, 0))
    services.record_attempt(p, 10, local(KOLKATA, 2026, 9, 2, 1, 30))
    assert p.current_streak == 2


def test_the_summary_and_effective_streak_use_the_shifted_day():
    p = owl(current_streak=3, best_streak=3, last_activity_date=dt.date(2026, 9, 1))
    night = local(KOLKATA, 2026, 9, 2, 1, 30)
    body = summary.build(p, night)
    assert body["today"] == "2026-09-01" and body["practised_today"] is True
    assert body["night_owl"] is True
    morning = local(KOLKATA, 2026, 9, 2, 3, 30)
    assert summary.build(p, morning)["today"] == "2026-09-02"
    assert streaks.effective_streak(p, localtime.local_date(p, morning)) == 3


def test_at_risk_is_judged_on_the_clock_and_the_shifted_day():
    p = owl(current_streak=3, best_streak=3, last_activity_date=dt.date(2026, 9, 1))
    assert not streaks.is_at_risk(
        p, local(KOLKATA, 2026, 9, 2, 1, 30)
    )  # still "yesterday", it is 1 a.m.
    assert streaks.is_at_risk(p, local(KOLKATA, 2026, 9, 2, 19, 0))  # new day, nothing yet, evening


def test_mastery_days_use_the_shifted_date(seeded):
    tw = twister()
    late = dict(score=95, verification_status="verified")
    for night_owl, expected_days in ((True, 1), (False, 2)):
        p = new_profile(timezone="Asia/Kolkata", night_owl=night_owl)
        row = UserTwisterStats(profile=p, twister=tw)
        for when in (local(KOLKATA, 2026, 9, 1, 22, 0), local(KOLKATA, 2026, 9, 2, 1, 0)):
            attempt = make_attempt(p, tw, when=when, **late)
            stats.apply_attempt_to_stats(p, row, attempt, distrusted=False)
        assert row.mastery_days_hit == expected_days, night_owl


def test_insights_bucket_by_the_shifted_day(user):
    client, profile = user
    Profile.objects.filter(pk=profile.pk).update(
        timezone_confirmed=True, timezone="Asia/Kolkata", night_owl=True
    )
    profile.refresh_from_db()
    tw = twister()
    make_attempt(profile, tw, when=local(KOLKATA, 2026, 9, 1, 22, 0))
    make_attempt(profile, tw, when=local(KOLKATA, 2026, 9, 2, 1, 0))  # night of the 1st
    make_attempt(profile, tw, when=local(KOLKATA, 2026, 9, 2, 4, 0))
    days = insights._collect_days(profile, dt.date(2026, 9, 1), dt.date(2026, 9, 2), None)
    assert {d: v.attempts for d, v in days.items()} == {
        dt.date(2026, 9, 1): 2,
        dt.date(2026, 9, 2): 1,
    }


def test_the_first_active_day_of_the_all_range_is_the_shifted_day(seeded):
    p = owl()
    make_attempt(p, twister(), when=local(KOLKATA, 2026, 9, 2, 1, 0))
    assert insights._first_active_day(p, dt.date(2026, 9, 10)) == dt.date(2026, 9, 1)


# --- the setting itself --------------------------------------------------------------------------------


def test_night_owl_is_writable_and_returned(user):
    client, _ = user
    assert client.get(f"{API}/me/").data["night_owl"] is False
    r = client.patch(f"{API}/me/", {"night_owl": True}, format="json")
    assert r.status_code == 200 and r.data["night_owl"] is True
    assert Profile.objects.get().night_owl is True


# --- one function owns the boundary ---------------------------------------------------------------------

PACKAGE = Path(localtime.__file__).parent
DIRECT_TZ_USE = re.compile(r"astimezone\(\s*(?:ZoneInfo|tzinfo_for)|TruncDate\([^)]*tzinfo")


def test_no_module_derives_a_local_day_without_going_through_localtime():
    """A new `astimezone(ZoneInfo(profile.timezone)).date()` would silently ignore night owl mode."""
    offenders = [
        str(path.relative_to(PACKAGE))
        for path in PACKAGE.rglob("*.py")
        if path.name != "localtime.py"
        and "migrations" not in path.parts
        and DIRECT_TZ_USE.search(path.read_text())
    ]
    assert offenders == []


# --- Night Owl / Early Bird ------------------------------------------------------------------------------


def unlocked(profile: Profile, when: dt.datetime, **attempt) -> set[str]:
    made = make_attempt(profile, twister(), when=when, **attempt)
    event = Event("attempt", profile, attempt=made, twister=made.twister)
    return {u.achievement.code for u in achievements.evaluate(event)}


@pytest.mark.parametrize(
    "hour,minute,badge",
    [
        (22, 59, None),
        (23, 0, "night_owl"),
        (23, 59, "night_owl"),
        (0, 0, "night_owl"),
        (2, 59, "night_owl"),
        (3, 0, None),
        (4, 59, None),
        (5, 0, "early_bird"),
        (7, 59, "early_bird"),
        (8, 0, None),
    ],
)
def test_clock_badges_at_their_boundaries(seeded, hour, minute, badge):
    p = new_profile(timezone="Asia/Kolkata")
    got = unlocked(p, local(KOLKATA, 2026, 9, 2, hour, minute)) & {"night_owl", "early_bird"}
    assert got == ({badge} if badge else set())


def test_the_two_badges_are_in_the_catalogue_with_their_icons(seeded):
    rows = {a.code: a for a in Achievement.objects.filter(code__in=["night_owl", "early_bird"])}
    assert (rows["night_owl"].icon, rows["early_bird"].icon) == ("moon", "sunrise")
    assert {r.tier for r in rows.values()} == {"bronze"} and {
        r.xp_reward for r in rows.values()
    } == {20}


def test_the_dst_day_judges_the_wall_clock_not_elapsed_hours(seeded):
    spring = new_profile(timezone="America/New_York")
    assert "night_owl" in unlocked(
        spring, dt.datetime(2026, 3, 8, 6, 59, tzinfo=dt.UTC)
    )  # 01:59 EST
    other = new_profile(timezone="America/New_York")
    assert "night_owl" not in unlocked(
        other, dt.datetime(2026, 3, 8, 7, 30, tzinfo=dt.UTC)
    )  # 03:30 EDT
    fall = new_profile(timezone="America/New_York")  # 01:30 happens twice on 2026-11-01
    assert "night_owl" in unlocked(fall, dt.datetime(2026, 11, 1, 6, 30, tzinfo=dt.UTC))


def test_an_unconfirmed_timezone_earns_neither_badge(seeded):
    """A default-UTC profile would be judged on the wrong clock, so it never qualifies."""
    p = new_profile()  # timezone defaults to UTC
    assert (
        unlocked(p, dt.datetime(2026, 9, 2, 1, 0, tzinfo=dt.UTC)) & {"night_owl", "early_bird"}
        == set()
    )
    assert (
        unlocked(p, dt.datetime(2026, 9, 2, 6, 0, tzinfo=dt.UTC)) & {"night_owl", "early_bird"}
        == set()
    )


def test_unscored_and_flagged_attempts_do_not_count(seeded):
    p = new_profile(timezone="Asia/Kolkata")
    night = local(KOLKATA, 2026, 9, 2, 1, 0)
    assert "night_owl" not in unlocked(p, night, kind="train")
    assert "night_owl" not in unlocked(p, night, flagged=True)
    assert "night_owl" in unlocked(p, night, kind="record")


def test_the_badge_pays_its_xp_once(seeded):
    p = new_profile(timezone="Asia/Kolkata")
    assert "night_owl" in unlocked(p, local(KOLKATA, 2026, 9, 2, 1, 0))
    paid = p.xp  # the badge's 20 plus First Words / Put to the Test
    assert "night_owl" not in unlocked(p, local(KOLKATA, 2026, 9, 3, 1, 0))
    assert p.xp == paid


@pytest.mark.parametrize("flag_on", [True, False])
def test_a_real_attempt_at_night_unlocks_only_while_the_flag_is_on(user, monkeypatch, flag_on):
    from .progress_helpers import freeze_time
    from .speak_helpers import submit

    client, profile = user
    Profile.objects.filter(pk=profile.pk).update(timezone_confirmed=True, timezone="Asia/Kolkata")
    FeatureFlag.objects.filter(code="achievements").update(enabled=flag_on)
    freeze_time(monkeypatch, local(KOLKATA, 2026, 9, 2, 1, 0))
    made = submit(client)
    assert made.status_code == 201
    codes = {a["code"] for a in made.data["achievements_unlocked"]}
    assert ("night_owl" in codes) is flag_on
