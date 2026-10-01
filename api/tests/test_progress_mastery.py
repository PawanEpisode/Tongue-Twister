import pytest
from django.utils import timezone

from twisters.models import Twister, UserTwisterStats
from twisters.progress import mastery

from .progress_helpers import make_stats, new_profile, twister


def stats(**over) -> UserTwisterStats:
    return UserTwisterStats(**{"attempts_count": 1, **over})


@pytest.mark.parametrize(
    "row,state",
    [
        (None, "new"),
        (stats(attempts_count=0), "new"),
        (stats(best_test_score=40), "practising"),
        (stats(attempts_count=3), "practising"),  # only train/drill attempts: no test score yet
        (stats(best_test_score=79), "practising"),
        (stats(best_test_score=80), "almost"),
        (stats(best_practice_score=85), "almost"),  # provisional scores count
        (stats(best_score=81, best_test_score=60), "almost"),
        (stats(best_test_score=95, mastered_at=timezone.now()), "mastered"),
        (stats(best_test_score=10, mastered_at=timezone.now()), "mastered"),  # mastery never lapses
    ],
)
def test_state_from_a_stats_row(row, state):
    assert mastery.mastery_state(row) == state


def test_almost_threshold_follows_the_setting(settings):
    settings.MASTERY_ALMOST_SCORE = 70
    assert mastery.mastery_state(stats(best_test_score=70)) == "almost"


@pytest.mark.django_db
def test_states_for_a_profile_come_from_one_query(seeded, django_assert_num_queries):
    profile = new_profile()
    hissers = [
        twister(category__slug="hissers"),
        *Twister.objects.filter(category__slug="poppers")[:3],
    ]
    make_stats(profile, hissers[0], mastered=True)
    make_stats(profile, hissers[1], best_test_score=85)
    make_stats(profile, hissers[2], best_test_score=50)
    make_stats(profile, hissers[3], attempts_count=0)
    other = new_profile()
    make_stats(other, hissers[0], mastered=True)

    with django_assert_num_queries(1):
        states = mastery.mastery_states_for(profile)

    assert states == {
        hissers[0].id: "mastered",
        hissers[1].id: "almost",
        hissers[2].id: "practising",
        hissers[3].id: "new",
    }


def test_random_buckets_fold_almost_into_practising():
    assert [mastery.bucket(s) for s in mastery.STATES] == [
        "new",
        "practising",
        "practising",
        "mastered",
    ]


@pytest.mark.django_db
def test_counts_only_published_mastered_twisters(seeded):
    profile = new_profile()
    hissers = list(Twister.objects.filter(category__slug="hissers")[:3])
    for tw in hissers:
        make_stats(profile, tw, mastered=True)
    make_stats(
        profile, Twister.objects.filter(category__slug="poppers").first(), best_test_score=99
    )
    Twister.objects.filter(pk=hissers[0].pk).update(is_published=False)

    assert mastery.mastered_count(profile) == 2
    assert mastery.mastered_by_category(profile) == {"hissers": 2}
