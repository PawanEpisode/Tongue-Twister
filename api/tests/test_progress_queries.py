"""N+1 guard for every progress read endpoint: a heavy account must cost the same number of queries as
a light one, so nothing here can grow with the amount of data behind it."""

import datetime as dt

import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from twisters.models import DailyActivity, Favorite, Twister, UserTwisterStats, UserWordStat

from .progress_helpers import API, at, freeze_time, make_attempt

ENDPOINTS = [
    ("/me/summary/", {}),
    ("/me/achievements/", {}),
    ("/me/stats/", {"range": "all"}),
    ("/me/activity/", {}),
    ("/me/favorites/", {}),
    ("/twisters/", {}),
    ("/twisters/", {"status": "in_progress", "sort": "best_desc"}),
    ("/twisters/", {"sort": "recommended", "q": "she"}),
    ("/twisters/facets/", {"difficulty": 2}),
    ("/twisters/random/", {}),
    ("/daily/", {}),
]


def queries(client, path, params) -> int:
    with CaptureQueriesContext(connection) as ctx:
        assert client.get(f"{API}{path}", params).status_code == 200
    return len(ctx)


def grow(profile, rows: int) -> None:
    everything = list(Twister.objects.order_by("id"))
    twisters = everything[:: len(everything) // rows][:rows]  # spread over every level and category
    for n, tw in enumerate(twisters):
        make_attempt(profile, tw, score=80 + n % 20, when=at(2026, 9, 1 + n % 9, 10))
        UserTwisterStats.objects.update_or_create(
            profile=profile,
            twister=tw,
            defaults={
                "attempts_count": 2,
                "best_test_score": 80 + n % 20,
                "mastered_at": at(2026, 9, 2) if n % 3 == 0 else None,
            },
        )
        Favorite.objects.get_or_create(profile=profile, twister=tw)
        DailyActivity.objects.get_or_create(
            profile=profile,
            local_date=dt.date(2026, 7, 1) + dt.timedelta(days=n),
            defaults={"attempts": 1},
        )
        UserWordStat.objects.get_or_create(
            profile=profile, word_norm=f"word{n}", defaults={"seen": 3, "wrong": 1, "weakness": 0.4}
        )


@pytest.mark.parametrize("path,params", ENDPOINTS)
def test_query_count_is_independent_of_data_volume(user, monkeypatch, path, params):
    client, profile = user
    freeze_time(monkeypatch, at(2026, 9, 10))
    grow(profile, 20)
    queries(client, path, params)  # warm-up: the first request of a day persists the daily twister
    light = queries(client, path, params)
    grow(profile, 100)
    assert queries(client, path, params) == light
