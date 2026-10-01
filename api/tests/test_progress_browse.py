"""Browse: progress filter, sort, `q`, facet counts and Random."""

import random
from collections import Counter

import pytest
from django.db.models import Count

from twisters.models import Favorite, Twister
from twisters.progress import browse

from .progress_helpers import API, error_code, make_attempt, make_stats

LIST = f"{API}/twisters/"


def listing(client, **params):
    return client.get(LIST, params)


def slugs(response) -> list[str]:
    return [t["slug"] for t in response.data["results"]]


def category(slug: str) -> list[Twister]:
    return list(Twister.objects.filter(category__slug=slug).order_by("difficulty", "id"))


# --- status -----------------------------------------------------------------------------------------


@pytest.fixture
def progress(user):
    """One twister per state among the rollers, plus a favourite with no stats at all."""
    client, profile = user
    a, b, c, d, *_ = category("rollers")
    make_stats(profile, a, mastered=True)
    make_stats(profile, b, attempts_count=2, best_test_score=50)
    make_stats(profile, c, attempts_count=0)  # a row with no attempts is still 'not started'
    Favorite.objects.create(profile=profile, twister=d)
    return client, profile, {"mastered": a, "practising": b, "untouched": c, "favourite": d}


def test_status_mastered(progress):
    client, _, tw = progress
    assert slugs(listing(client, status="mastered")) == [tw["mastered"].slug]


def test_status_in_progress_is_tried_but_not_mastered(progress):
    client, _, tw = progress
    assert slugs(listing(client, status="in_progress")) == [tw["practising"].slug]


def test_status_not_started_is_everything_never_attempted(progress):
    client, _, tw = progress
    r = listing(client, status="not_started")
    assert r.data["count"] == 205 - 2
    assert {tw["untouched"].slug, tw["favourite"].slug} <= set(
        slugs(listing(client, status="not_started", category="rollers"))
    )


def test_status_favorites(progress):
    client, _, tw = progress
    assert slugs(listing(client, status="favorites")) == [tw["favourite"].slug]


def test_status_combines_with_the_other_filters(progress):
    client, _, tw = progress
    assert (
        listing(client, status="mastered", difficulty=tw["mastered"].difficulty).data["count"] == 1
    )
    other = 1 if tw["mastered"].difficulty != 1 else 2
    assert listing(client, status="mastered", difficulty=other).data["count"] == 0


def test_status_only_reflects_the_callers_own_progress(progress, auth_client):
    _, _, tw = progress
    other = auth_client()
    other.get(f"{API}/me/")
    assert listing(other, status="mastered").data["count"] == 0
    assert listing(other, status="not_started").data["count"] == 205


def test_status_needs_a_login(seeded, anon):
    r = listing(anon, status="mastered")
    assert r.status_code == 400 and error_code(r) == "validation_error"
    assert "Sign in" in str(r.data["error"]["details"]["status"])


def test_unknown_status_is_rejected_not_ignored(progress):
    client, *_ = progress
    r = listing(client, status="done")
    assert r.status_code == 400 and error_code(r) == "validation_error"


# --- sort -------------------------------------------------------------------------------------------


def ids(response) -> list[int]:
    return [Twister.objects.get(slug=s).id for s in slugs(response)]


def test_default_and_anonymous_recommended_order_is_difficulty_then_id(seeded, anon):
    expected = list(Twister.objects.order_by("difficulty", "id").values_list("slug", flat=True))[
        :24
    ]
    assert slugs(listing(anon)) == expected
    assert slugs(listing(anon, sort="recommended")) == expected


def test_recommended_puts_the_mastered_last_when_signed_in(progress):
    client, profile, _ = progress
    natural = slugs(listing(client, category="rollers", sort="recommended"))
    rollers = category("rollers")
    mastered = rollers[0].slug
    assert natural[-1] == mastered
    assert natural[:-1] == [t.slug for t in rollers if t.slug != mastered]


@pytest.mark.parametrize(
    "sort,key",
    [
        ("newest", lambda t: (-t.created_at.timestamp(), -t.id)),
        ("shortest", lambda t: (t.word_count, t.id)),
        ("longest", lambda t: (-t.word_count, t.id)),
        ("hardest", lambda t: (-t.difficulty, t.id)),
        ("easiest", lambda t: (t.difficulty, t.id)),
    ],
)
def test_each_sort_orders_the_whole_catalogue(seeded, anon, sort, key):
    Twister.objects.filter(slug="peter-piper").update(word_count=1)  # force ties to be broken by id
    expected = [t.slug for t in sorted(Twister.objects.filter(is_published=True), key=key)][:24]
    assert slugs(listing(anon, sort=sort)) == expected


def test_best_score_sorts_put_unplayed_twisters_last_descending_and_first_ascending(user):
    client, profile = user
    rollers = category("rollers")
    for tw, best in ((rollers[3], 90), (rollers[5], 40)):
        make_stats(profile, tw, best_test_score=best)
        make_attempt(profile, tw, score=best)
    desc = listing(client, category="rollers", sort="best_desc")
    assert slugs(desc)[:2] == [rollers[3].slug, rollers[5].slug]
    assert [t["best_score"] for t in desc.data["results"]][:3] == [90, 40, None]
    asc = listing(client, category="rollers", sort="best_asc")
    assert slugs(asc)[-2:] == [rollers[5].slug, rollers[3].slug]
    assert asc.data["results"][0]["best_score"] is None
    assert len(slugs(asc)) == len(rollers)
    assert slugs(asc)[:-2] == [
        t.slug for t in rollers if t.id not in (rollers[3].id, rollers[5].id)
    ]


def test_best_score_sort_uses_only_your_own_scores(user, auth_client):
    client, profile = user
    rollers = category("rollers")
    make_stats(profile, rollers[7], best_test_score=99)
    other = auth_client()
    other.get(f"{API}/me/")
    assert slugs(listing(other, category="rollers", sort="best_desc")) == [t.slug for t in rollers]


def test_best_score_sorts_need_a_login(seeded, anon):
    for sort in ("best_desc", "best_asc"):
        r = listing(anon, sort=sort)
        assert r.status_code == 400 and error_code(r) == "validation_error"


def test_unknown_sort_is_a_400(user):
    client, _ = user
    r = listing(client, sort="random")
    assert r.status_code == 400 and error_code(r) == "validation_error"


def test_sort_wins_over_ordering(seeded, anon):
    by_ordering = slugs(listing(anon, ordering="-word_count"))
    both = slugs(listing(anon, ordering="-word_count", sort="shortest"))
    assert both == slugs(listing(anon, sort="shortest")) and both != by_ordering
    assert slugs(listing(anon, ordering="-word_count")) == by_ordering  # ordering alone still works


# --- search alias ---------------------------------------------------------------------------------------


def test_q_is_an_alias_of_search(seeded, anon):
    by_search = listing(anon, search="seashells")
    assert by_search.data["count"] > 0
    assert slugs(listing(anon, q="seashells")) == slugs(by_search)
    assert slugs(listing(anon, q="zzzzqqq")) == []
    assert slugs(listing(anon, search="seashells", q="zzzzqqq")) == slugs(by_search)  # search wins


# --- facets -------------------------------------------------------------------------------------------------


def counts(**filters) -> dict:
    qs = Twister.objects.filter(is_published=True, **filters)
    return {
        "levels": {str(k): v for k, v in qs.values_list("difficulty").annotate(n=Count("id"))},
        "categories": dict(
            qs.exclude(category=None).values_list("category__slug").annotate(n=Count("id"))
        ),
        "origins": dict(qs.values_list("origin").annotate(n=Count("id"))),
    }


def facets(client, **params):
    return client.get(f"{API}/twisters/facets/", params)


def test_facets_without_filters(seeded, anon):
    r = facets(anon)
    assert r.status_code == 200
    expected = counts()
    assert r.data["total"] == 205
    assert r.data["levels"] == {"1": 16, "2": 74, "3": 85, "4": 30}
    assert (
        r.data["categories"] == expected["categories"] and sum(r.data["categories"].values()) == 205
    )
    assert r.data["origins"] == expected["origins"]
    assert list(r.data["categories"]) == list(
        Twister.objects.filter(category__isnull=False)
        .order_by("category__sort_order")
        .values_list("category__slug", flat=True)
        .distinct()
    )


def test_each_facet_ignores_its_own_filter(seeded, anon):
    r = facets(anon, difficulty=1)
    only_easy = counts(difficulty=1)
    assert r.data["total"] == 16
    assert r.data["levels"] == {
        "1": 16,
        "2": 74,
        "3": 85,
        "4": 30,
    }  # the level chips still show every level
    assert r.data["categories"] == {
        **dict.fromkeys(counts()["categories"], 0),
        **only_easy["categories"],
    }
    assert r.data["origins"] == {**dict.fromkeys(["classic", "modern"], 0), **only_easy["origins"]}

    r = facets(anon, category="rollers")
    assert r.data["total"] == 14
    assert r.data["categories"] == counts()["categories"]  # unchanged: its own dimension
    assert r.data["levels"] == {
        **dict.fromkeys(["1", "2", "3", "4"], 0),
        **counts(category__slug="rollers")["levels"],
    }


def test_facets_combine_several_filters(seeded, anon):
    r = facets(anon, difficulty=3, category="poppers", origin="classic")
    expected = Twister.objects.filter(
        difficulty=3, category__slug="poppers", origin="classic"
    ).count()
    assert r.data["total"] == expected
    assert (
        r.data["levels"]["3"]
        == Twister.objects.filter(category__slug="poppers", origin="classic", difficulty=3).count()
    )
    assert r.data["origins"]["classic"] == expected
    assert r.data["categories"]["poppers"] == expected


def test_facets_respect_word_counts_and_search(seeded, anon):
    long_ones = Twister.objects.filter(word_count__gte=50)
    r = facets(anon, min_words=50)
    assert (
        r.data["total"] == long_ones.count() and sum(r.data["levels"].values()) == long_ones.count()
    )
    r = facets(anon, q="seashells")
    assert r.data["total"] == listing(anon, q="seashells").data["count"] > 0
    assert r.data["total"] == facets(anon, search="seashells").data["total"]


def test_facets_zero_fill_and_unknown_values(seeded, anon):
    r = facets(anon, category="no-such-category")
    assert r.data["total"] == 0 and r.data["levels"] == dict.fromkeys(["1", "2", "3", "4"], 0)
    assert r.data["categories"] == counts()["categories"]
    assert set(r.data["origins"]) == {"classic", "modern"}


def test_facets_only_count_published_twisters(seeded, anon):
    Twister.objects.filter(slug="peter-piper").update(is_published=False)
    assert facets(anon).data["total"] == 204


def test_facets_reject_bad_filters(seeded, anon):
    r = facets(anon, difficulty="hard")
    assert r.status_code == 400 and error_code(r) == "validation_error"


def test_facets_cache_only_for_anonymous_callers(user, anon):
    client, _ = user
    assert (
        anon.get(f"{API}/twisters/facets/").headers["Cache-Control"]
        == "public, max-age=60, stale-while-revalidate=300"
    )
    assert "public" not in client.get(f"{API}/twisters/facets/").headers.get("Cache-Control", "")


def test_facets_ignore_status_and_sort(progress):
    client, *_ = progress
    assert facets(client, status="mastered", sort="newest").data == facets(client).data


def test_list_carries_mastery_and_personal_fields(progress):
    client, _, tw = progress
    by = {t["slug"]: t for t in listing(client, category="rollers").data["results"]}
    assert by[tw["mastered"].slug]["mastery"] == "mastered"
    assert by[tw["practising"].slug]["mastery"] == "practising"
    assert by[tw["untouched"].slug]["mastery"] == "new"
    assert by[tw["favourite"].slug]["is_favorite"] is True


def test_anonymous_twisters_have_no_mastery(seeded, anon):
    assert {t["mastery"] for t in listing(anon).data["results"]} == {None}
    assert anon.get(f"{LIST}peter-piper/").data["mastery"] is None


# --- random -------------------------------------------------------------------------------------------------------


def pick(client, **params):
    return client.get(f"{API}/twisters/random/", params)


def test_random_respects_the_filters(seeded, anon):
    for _ in range(15):
        body = pick(anon, difficulty=4, category="th-tangles", origin="classic").data
        assert (body["difficulty"], body["category"], body["origin"]) == (
            4,
            "th-tangles",
            "classic",
        )


def test_random_honours_exclude(seeded, anon):
    pair = list(
        Twister.objects.filter(category__slug="rollers", difficulty=3).values_list(
            "slug", flat=True
        )[:2]
    )
    assert len(pair) == 2
    for _ in range(10):
        assert pick(anon, category="rollers", difficulty=3, exclude=pair[0]).data["slug"] != pair[0]
    r = pick(anon, category="rollers", difficulty=3, exclude=",".join(pair))
    survivors = Twister.objects.filter(category__slug="rollers", difficulty=3).exclude(
        slug__in=pair
    )
    assert r.status_code == (200 if survivors.exists() else 404)


def test_random_is_404_when_nothing_is_left(seeded, anon, settings):
    settings.RANDOM_EXCLUDE_MAX = 500
    only = Twister.objects.get(slug="peter-piper")
    r = pick(
        anon,
        category=only.category.slug,
        difficulty=only.difficulty,
        exclude=",".join(
            Twister.objects.filter(category=only.category, difficulty=only.difficulty).values_list(
                "slug", flat=True
            )
        ),
    )
    assert r.status_code == 404 and error_code(r) == "not_found"
    r = pick(anon, category="no-such-category")
    assert r.status_code == 404 and error_code(r) == "not_found"


def test_random_caps_the_exclude_list(seeded, anon, settings):
    many = [t.slug for t in Twister.objects.all()[: settings.RANDOM_EXCLUDE_MAX + 1]]
    r = pick(anon, exclude=",".join(many))
    assert r.status_code == 400 and error_code(r) == "validation_error"
    assert pick(anon, exclude=",".join(many[:-1])).status_code == 200
    assert (
        pick(anon, exclude=",".join(many[:-1] + many[:3])).status_code == 200
    )  # duplicates are free
    assert pick(anon, exclude=" , ,").status_code == 200


def test_random_rejects_bad_filters(seeded, anon):
    assert pick(anon, difficulty="x").status_code == 400


def test_random_is_never_cached_and_anonymous_is_uniform_shape(seeded, anon):
    r = pick(anon)
    assert r.headers["Cache-Control"] == "no-store" and r.data["mastery"] is None


def test_random_leans_on_the_callers_mastery(user, settings):
    client, profile = user
    rollers = category("rollers")
    for tw in rollers[:-1]:
        make_stats(profile, tw, mastered=True)
    settings.RANDOM_WEIGHTS = {"new": 1, "practising": 0, "mastered": 0}
    for _ in range(10):
        assert pick(client, category="rollers").data["slug"] == rollers[-1].slug
    settings.RANDOM_WEIGHTS = {"new": 0, "practising": 0, "mastered": 1}
    for _ in range(10):
        assert pick(client, category="rollers").data["slug"] != rollers[-1].slug


def test_random_ignores_other_users_progress(user, auth_client, settings):
    client, profile = user
    rollers = category("rollers")
    for tw in rollers[:-1]:
        make_stats(profile, tw, mastered=True)
    settings.RANDOM_WEIGHTS = {"new": 1, "practising": 0, "mastered": 0}
    other = auth_client()
    other.get(f"{API}/me/")
    assert {pick(other, category="rollers").data["slug"] for _ in range(40)} - {rollers[-1].slug}


# --- pick_random, without HTTP -------------------------------------------------------------------------------------


STATES = {
    **dict.fromkeys(range(1, 101), "new"),
    **{i: ("almost" if i % 2 else "practising") for i in range(101, 201)},
    **dict.fromkeys(range(201, 301), "mastered"),
}
WEIGHTS = {"new": 60, "practising": 30, "mastered": 10}


def shares(candidates, states, draws=6000, seed=7, weights=WEIGHTS) -> Counter:
    rng = random.Random(seed)
    picks = Counter(
        browse.mastery.bucket(
            states.get(browse.pick_random(candidates, states, rng=rng, weights=weights), "new")
        )
        for _ in range(draws)
    )
    return Counter({k: v / draws for k, v in picks.items()})


def test_bucket_weights_are_honoured_within_tolerance():
    share = shares(list(STATES), STATES)
    assert share["new"] == pytest.approx(0.60, abs=0.03)
    assert share["practising"] == pytest.approx(0.30, abs=0.03)  # 'almost' counts as practising
    assert share["mastered"] == pytest.approx(0.10, abs=0.03)


def test_empty_buckets_are_dropped_and_weights_renormalised():
    candidates = [i for i in STATES if STATES[i] != "practising" and STATES[i] != "almost"]
    share = shares(candidates, STATES)
    assert share["new"] == pytest.approx(60 / 70, abs=0.03) and "practising" not in share
    only_mastered = [i for i in STATES if STATES[i] == "mastered"]
    assert shares(only_mastered, STATES, draws=50) == {"mastered": 1.0}


def test_inside_a_bucket_the_pick_is_uniform():
    new_ids = [i for i in STATES if STATES[i] == "new"]
    rng = random.Random(3)
    drawn = Counter(
        browse.pick_random(new_ids, STATES, rng=rng, weights={"new": 1}) for _ in range(5000)
    )
    assert set(drawn) == set(new_ids) and max(drawn.values()) < 5000 / 100 * 2


def test_anonymous_picks_ignore_buckets():
    rng = random.Random(5)
    draws = Counter(browse.pick_random(list(STATES), None, rng=rng) for _ in range(6000))
    by_state = Counter()
    for twister_id, n in draws.items():
        by_state[browse.mastery.bucket(STATES[twister_id])] += n / 6000
    assert all(v == pytest.approx(1 / 3, abs=0.04) for v in by_state.values())


def test_all_zero_weights_fall_back_to_uniform_buckets():
    share = shares(list(STATES), STATES, weights={"new": 0, "practising": 0, "mastered": 0})
    assert all(v == pytest.approx(1 / 3, abs=0.04) for v in share.values())


def test_states_missing_from_the_map_count_as_new():
    assert browse.pick_random([1, 2, 3], {}, rng=random.Random(1), weights={"new": 1}) in (1, 2, 3)


def test_no_candidates_means_no_pick():
    assert browse.pick_random([], STATES) is None and browse.pick_random([], None) is None


def test_seeded_picks_are_reproducible():
    first = [browse.pick_random(list(STATES), STATES, rng=random.Random(9)) for _ in range(3)]
    assert first[0] == first[1] == first[2]
