"""Streak rules (D16/D17) driven through the same service the attempt and session flows use."""

import datetime as dt

import pytest

from twisters.models import DailyActivity, PracticeMode, PracticeSession, Profile
from twisters.practice import services
from twisters.progress import streaks

from .progress_helpers import at, new_profile, twister

pytestmark = pytest.mark.django_db
DAY = dt.timedelta(days=1)
D0 = at(2026, 9, 1, 12)


def practise(profile: Profile, day: int, hour: int = 12) -> None:
    """A scored attempt on the ``day``-th day after D0 (0 = 2026-09-01)."""
    services.record_attempt(profile, 10, at(2026, 9, 1, hour) + day * DAY)


def run(profile: Profile, days: range | list[int]) -> Profile:
    for d in days:
        practise(profile, d)
    return profile


def row(profile: Profile, day: dt.date) -> DailyActivity:
    return DailyActivity.objects.get(profile=profile, local_date=day)


def test_consecutive_days_extend_the_streak():
    p = run(new_profile(), range(3))
    assert (p.current_streak, p.best_streak) == (3, 3)
    assert p.last_activity_date == dt.date(2026, 9, 3)


def test_a_second_attempt_on_the_same_day_changes_nothing():
    p = new_profile()
    practise(p, 0)
    practise(p, 0)
    assert (p.current_streak, p.streak_freezes) == (1, 0)
    assert row(p, dt.date(2026, 9, 1)).attempts == 2


def test_a_missed_day_without_a_freeze_resets_to_one():
    p = run(new_profile(), [0, 1, 2])
    practise(p, 4)  # day 3 missed
    assert (p.current_streak, p.best_streak) == (1, 3)
    assert not DailyActivity.objects.filter(profile=p, freeze_used=True).exists()


def test_a_freeze_bridges_exactly_one_missed_day():
    p = run(new_profile(), range(7))  # the 7th day banks a freeze
    assert (p.current_streak, p.streak_freezes) == (7, 1)
    practise(p, 8)  # day 7 (2026-09-08) missed
    assert (p.current_streak, p.best_streak, p.streak_freezes) == (8, 8, 0)

    bridged = row(p, dt.date(2026, 9, 8))
    assert bridged.freeze_used is True and bridged.qualifies_streak is False
    assert row(p, dt.date(2026, 9, 9)).qualifies_streak is True


def test_the_bridged_days_existing_row_is_marked_not_duplicated():
    p = run(new_profile(), range(7))
    DailyActivity.objects.create(profile=p, local_date=dt.date(2026, 9, 8), read_along_ms=5000)
    practise(p, 8)
    assert DailyActivity.objects.filter(profile=p, local_date=dt.date(2026, 9, 8)).count() == 1
    assert row(p, dt.date(2026, 9, 8)).freeze_used is True


def test_two_missed_days_reset_and_keep_the_freeze():
    p = run(new_profile(), range(7))
    practise(p, 9)  # days 7 and 8 missed
    assert (p.current_streak, p.best_streak, p.streak_freezes) == (1, 7, 1)
    assert not DailyActivity.objects.filter(profile=p, freeze_used=True).exists()


def test_freezes_are_earned_at_7_and_14_and_capped_at_two():
    p = new_profile()
    seen = []
    for d in range(21):
        practise(p, d)
        seen.append((p.current_streak, p.streak_freezes))
    assert seen[5] == (6, 0) and seen[6] == (7, 1)
    assert seen[13] == (14, 2)
    assert seen[20] == (21, 2)  # 21 would earn a third: capped


def test_a_bridged_day_continues_the_streak_towards_the_next_freeze():
    p = run(new_profile(), range(6))  # 6 days, no freeze yet
    p.streak_freezes = 1
    p.save()
    practise(p, 7)  # one missed day bridged -> streak 7 -> earns a freeze while spending one
    assert (p.current_streak, p.streak_freezes) == (7, 1)


def test_a_reset_never_earns_a_freeze():
    p = run(new_profile(), [0])
    practise(p, 7)
    assert (p.current_streak, p.streak_freezes) == (1, 0)


def test_a_back_dated_day_qualifies_but_does_not_move_the_streak():
    p = run(new_profile(), [5, 6])
    services.record_attempt(p, 10, D0)  # an offline attempt from day 0
    assert (p.current_streak, p.last_activity_date) == (2, dt.date(2026, 9, 7))
    assert row(p, dt.date(2026, 9, 1)).qualifies_streak is True


def test_timezone_decides_which_day_an_attempt_belongs_to():
    p = new_profile(timezone="Asia/Kolkata")  # UTC+5:30
    services.record_attempt(p, 10, at(2026, 9, 1, 18, 0))  # 23:30 local, 1 Sep
    services.record_attempt(p, 10, at(2026, 9, 1, 19, 0))  # 00:30 local, 2 Sep
    assert p.current_streak == 2
    assert {r.local_date for r in DailyActivity.objects.filter(profile=p)} == {
        dt.date(2026, 9, 1),
        dt.date(2026, 9, 2),
    }
    utc = new_profile()  # the same two instants are one day in UTC
    services.record_attempt(utc, 10, at(2026, 9, 1, 18, 0))
    services.record_attempt(utc, 10, at(2026, 9, 1, 19, 0))
    assert utc.current_streak == 1


# --- reading the streak --------------------------------------------------------------------------


def streak_profile(last: dt.date, streak=4, freezes=0) -> Profile:
    return new_profile(
        current_streak=streak, best_streak=streak, last_activity_date=last, streak_freezes=freezes
    )


@pytest.mark.parametrize(
    "days_ago,freezes,expected",
    [
        (0, 0, 4),  # practised today
        (1, 0, 4),  # yesterday: still alive, today is open
        (2, 0, 0),  # a missed day and no freeze: lapsed
        (2, 1, 4),  # a freeze would bridge it
        (3, 1, 0),  # two missed days: freezes cannot help
        (30, 2, 0),
    ],
)
def test_effective_streak(days_ago, freezes, expected):
    today = dt.date(2026, 9, 10)
    p = streak_profile(today - days_ago * DAY, freezes=freezes)
    assert streaks.effective_streak(p, today) == expected
    assert p.current_streak == 4  # reading never rewrites the stored value


def test_no_activity_means_no_streak():
    assert streaks.effective_streak(new_profile(), dt.date(2026, 9, 10)) == 0


@pytest.mark.parametrize(
    "streak,expected",
    [(0, 3), (2, 3), (3, 7), (6, 7), (7, 14), (29, 30), (60, 100), (99, 100), (100, None)],
)
def test_next_milestone_is_strictly_above(streak, expected):
    assert streaks.next_milestone(streak) == expected


@pytest.mark.parametrize(
    "hour,minute,at_risk", [(17, 59, False), (18, 0, True), (23, 59, True), (0, 5, False)]
)
def test_at_risk_begins_at_the_evening_hour(hour, minute, at_risk):
    p = streak_profile(dt.date(2026, 9, 9))  # practised yesterday
    assert streaks.is_at_risk(p, at(2026, 9, 10, hour, minute)) is at_risk


def test_at_risk_uses_the_profiles_clock_not_utc():
    p = streak_profile(dt.date(2026, 9, 9))
    p.timezone = "Asia/Kolkata"
    assert streaks.is_at_risk(p, at(2026, 9, 10, 12, 30)) is True  # 18:00 in Kolkata
    assert streaks.is_at_risk(p, at(2026, 9, 10, 12, 29)) is False


def test_at_risk_needs_a_live_streak_and_an_idle_day(settings):
    late = at(2026, 9, 10, 20)
    assert (
        streaks.is_at_risk(streak_profile(dt.date(2026, 9, 10)), late) is False
    )  # practised today
    assert streaks.is_at_risk(streak_profile(dt.date(2026, 9, 7)), late) is False  # already lapsed
    assert streaks.is_at_risk(new_profile(), late) is False
    settings.STREAK_AT_RISK_HOUR = 21
    assert streaks.is_at_risk(streak_profile(dt.date(2026, 9, 9)), late) is False


# --- what qualifies -------------------------------------------------------------------------------


def read_along(profile: Profile, *, passes: int, active_ms: int, when=D0) -> None:
    session = PracticeSession.objects.create(
        profile=profile,
        twister=twister(),
        mode=PracticeMode.READ_ALONG,
        passes_completed=passes,
        active_ms=active_ms,
    )
    services.record_read_along(profile, session, when)


def test_a_read_along_pass_of_30_seconds_qualifies(seeded):
    p = new_profile()
    read_along(p, passes=1, active_ms=30_000)
    assert p.current_streak == 1 and row(p, dt.date(2026, 9, 1)).qualifies_streak


@pytest.mark.parametrize("passes,active_ms", [(1, 29_999), (0, 120_000)])
def test_a_short_or_unfinished_read_along_does_not(seeded, passes, active_ms):
    p = new_profile()
    read_along(p, passes=passes, active_ms=active_ms)
    assert p.current_streak == 0
    assert row(p, dt.date(2026, 9, 1)).qualifies_streak is False
