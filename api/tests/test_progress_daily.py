import datetime as dt

import pytest
from django.db.models.query import QuerySet

from twisters.models import DailyTwister, Favorite, Twister
from twisters.progress import daily

from .progress_helpers import API, at, error_code, freeze_time, make_stats

NOW = at(2026, 9, 10, 12)
TODAY = dt.date(2026, 9, 10)


@pytest.fixture
def clock(monkeypatch):
    freeze_time(monkeypatch, NOW)


def fetch(client, **params):
    return client.get(f"{API}/daily/", params)


def expected_auto(day: dt.date) -> Twister:
    ids = list(
        Twister.objects.filter(is_published=True).order_by("id").values_list("id", flat=True)
    )
    return Twister.objects.get(pk=ids[day.toordinal() % len(ids)])


def test_the_default_is_todays_utc_pick_in_an_envelope(seeded, anon, clock):
    r = fetch(anon)
    assert r.status_code == 200
    assert set(r.data) == {"day", "source", "twister"}
    assert (r.data["day"], r.data["source"]) == ("2026-09-10", "auto")
    assert r.data["twister"]["slug"] == expected_auto(TODAY).slug
    assert r.data["twister"]["mastery"] is None and r.data["twister"]["is_favorite"] is False


def test_the_pick_rule_is_unchanged_from_before_the_table_existed(seeded, anon, clock):
    # the legacy rotation: published ids in order, indexed by the day's ordinal
    assert fetch(anon).data["twister"]["slug"] == expected_auto(TODAY).slug
    assert (
        fetch(anon, day="2026-09-09").data["twister"]["slug"]
        == expected_auto(dt.date(2026, 9, 9)).slug
    )


def test_the_first_request_persists_the_pick_and_it_never_changes(seeded, anon, clock):
    first = fetch(anon).data["twister"]["slug"]
    row = DailyTwister.objects.get(day=TODAY)
    assert (row.twister.slug, row.source) == (first, "auto")
    Twister.objects.create(slug="brand-new", text="a brand new twister here")  # shifts the rotation
    Twister.objects.filter(slug=first).update(is_published=False)  # even unpublishing the pick
    assert fetch(anon).data["twister"]["slug"] == first
    assert DailyTwister.objects.filter(day=TODAY).count() == 1


def test_an_editorial_row_wins(seeded, anon, clock):
    chosen = Twister.objects.get(slug="peter-piper")
    assert expected_auto(TODAY) != chosen
    DailyTwister.objects.create(day=TODAY, twister=chosen)  # default source: editorial
    body = fetch(anon).data
    assert (body["source"], body["twister"]["slug"]) == ("editorial", "peter-piper")


def test_the_legacy_endpoint_returns_the_same_twister_bare(seeded, anon, clock):
    legacy = anon.get(f"{API}/twisters/daily/")
    assert legacy.status_code == 200 and "twister" not in legacy.data
    assert legacy.data["slug"] == fetch(anon).data["twister"]["slug"]
    DailyTwister.objects.filter(day=TODAY).update(twister=Twister.objects.get(slug="peter-piper"))
    assert anon.get(f"{API}/twisters/daily/").data["slug"] == "peter-piper"


def test_a_race_for_the_same_day_is_won_by_the_first_writer(seeded, clock, monkeypatch):
    winner = Twister.objects.get(slug="peter-piper")
    real_pick = daily.auto_pick

    def pick_then_lose_the_race(day):
        chosen = real_pick(day)
        DailyTwister.objects.create(day=day, twister=winner)  # another request commits first
        return chosen

    monkeypatch.setattr(daily, "auto_pick", pick_then_lose_the_race)
    assert daily.daily_twister(TODAY).twister == winner
    assert DailyTwister.objects.filter(day=TODAY).count() == 1


def test_the_unique_violation_path_adopts_the_winner(seeded, clock, monkeypatch):
    """Django's get_or_create sees no row, loses the INSERT to a competitor, and re-reads theirs."""
    winner = Twister.objects.get(slug="peter-piper")
    real_pick = daily.auto_pick

    def competitor_commits_after_our_check(day):
        chosen = real_pick(day)
        DailyTwister.objects.create(day=day, twister=winner)
        return chosen

    real_get = QuerySet.get
    calls = {"n": 0}

    def blind_first_get(self, *args, **kwargs):
        if self.model is DailyTwister and calls["n"] == 0 and "day" in kwargs:
            calls["n"] += 1
            raise DailyTwister.DoesNotExist  # the lookup inside get_or_create misses...
        return real_get(
            self, *args, **kwargs
        )  # ...so the INSERT hits the primary key, then re-reads

    monkeypatch.setattr(daily, "auto_pick", competitor_commits_after_our_check)
    monkeypatch.setattr(QuerySet, "get", blind_first_get)
    assert daily.daily_twister(TODAY).twister == winner
    assert calls["n"] == 1
    assert DailyTwister.objects.filter(day=TODAY).count() == 1


def test_day_bounds(seeded, anon, clock):
    assert fetch(anon, day="2026-09-10").status_code == 200  # today
    assert fetch(anon, day="2026-07-12").status_code == 200  # exactly 60 days back
    for bad in ("2026-07-11", "2026-09-11", "2027-01-01", "yesterday", "2026-13-01", "20260910"):
        r = fetch(anon, day=bad)
        assert r.status_code == 400 and error_code(r) == "validation_error", bad
    assert fetch(anon, day="").data["day"] == "2026-09-10"  # blank means 'not given'


def test_a_past_day_is_deterministic_and_persisted(seeded, anon, clock):
    first = fetch(anon, day="2026-08-20").data
    assert (
        first["day"] == "2026-08-20"
        and first["twister"]["slug"] == expected_auto(dt.date(2026, 8, 20)).slug
    )
    assert DailyTwister.objects.filter(day=dt.date(2026, 8, 20)).exists()


def test_the_default_day_is_utc_not_local(seeded, anon, monkeypatch):
    freeze_time(monkeypatch, at(2026, 9, 10, 23, 30))
    assert fetch(anon).data["day"] == "2026-09-10"
    freeze_time(monkeypatch, at(2026, 9, 11, 0, 5))
    assert fetch(anon).data["day"] == "2026-09-11"


def test_no_twisters_is_a_404_on_both_endpoints(db, anon, clock):
    assert fetch(anon).status_code == 404
    assert anon.get(f"{API}/twisters/daily/").status_code == 404


def test_cache_headers_depend_on_who_is_asking(user, anon, clock):
    client, _ = user
    assert fetch(anon).headers["Cache-Control"] == "public, max-age=60"
    assert fetch(client).headers["Cache-Control"] == "private, max-age=60"


def test_signed_in_callers_get_their_personal_fields(user, clock):
    client, profile = user
    today = expected_auto(TODAY)
    Favorite.objects.create(profile=profile, twister=today)
    make_stats(profile, today, best_test_score=85)
    body = fetch(client).data["twister"]
    assert (body["is_favorite"], body["mastery"]) == (True, "almost")
