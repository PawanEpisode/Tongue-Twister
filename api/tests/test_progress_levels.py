import pytest

from twisters.levels import XP_PER_LEVEL, level_floor, level_for, level_progress
from twisters.models import Profile


@pytest.mark.parametrize(
    "xp,level",
    [(0, 1), (199, 1), (200, 2), (399, 2), (400, 3), (1999, 10), (2000, 11)],
)
def test_level_steps_every_200_xp(xp, level):
    assert level_for(xp) == level


@pytest.mark.parametrize("level", [2, 3, 10])
def test_floor_is_where_the_level_begins(level):
    floor = level_floor(level)
    assert level_for(floor) == level and level_for(floor - 1) == level - 1


def test_floor_never_goes_below_level_one():
    assert level_floor(0) == level_floor(-3) == 0


@pytest.mark.parametrize(
    "xp,expected",
    [
        (0, (0, XP_PER_LEVEL)),
        (420, (20, XP_PER_LEVEL)),
        (199, (199, XP_PER_LEVEL)),
        (200, (0, 200)),
    ],
)
def test_progress_is_xp_into_the_level_and_the_level_size(xp, expected):
    assert level_progress(xp) == expected


def test_profile_level_uses_the_shared_formula():
    assert Profile(xp=420).level == level_for(420) == 3
