from twisters.models import Favorite, Twister

from .progress_helpers import API, at, error_code, make_attempt, make_stats, new_profile

SLUG = "peter-piper"


def put(client, slug=SLUG):
    return client.put(f"{API}/me/favorites/{slug}/")


def delete(client, slug=SLUG):
    return client.delete(f"{API}/me/favorites/{slug}/")


def test_put_sets_and_delete_clears_idempotently(user):
    client, profile = user
    assert [put(client).data, put(client).data] == [{"is_favorite": True}] * 2
    assert Favorite.objects.filter(profile=profile).count() == 1
    assert [delete(client).data, delete(client).data] == [{"is_favorite": False}] * 2
    assert Favorite.objects.filter(profile=profile).count() == 0
    assert delete(client).status_code == 200  # clearing what was never set is fine


def test_put_is_state_not_a_toggle(user):
    client, _ = user
    for _ in range(3):
        assert put(client).data["is_favorite"] is True


def test_unknown_and_unpublished_slugs_are_404(user):
    client, _ = user
    for call in (put, delete):
        r = call(client, "no-such-twister")
        assert r.status_code == 404 and error_code(r) == "not_found"
    Twister.objects.filter(slug=SLUG).update(is_published=False)
    assert put(client).status_code == 404


def test_the_old_toggle_still_works_alongside(user):
    client, profile = user
    assert client.post(f"{API}/twisters/{SLUG}/favorite/").data == {"is_favorite": True}
    assert put(client).data == {"is_favorite": True}  # already set: stays set
    assert client.post(f"{API}/twisters/{SLUG}/favorite/").data == {"is_favorite": False}
    assert not Favorite.objects.filter(profile=profile).exists()


def test_favourites_need_a_login(seeded, anon):
    assert anon.get(f"{API}/me/favorites/").status_code == 401
    assert anon.put(f"{API}/me/favorites/{SLUG}/").status_code == 401
    assert anon.delete(f"{API}/me/favorites/{SLUG}/").status_code == 401


def test_list_is_newest_first_in_the_browse_shape(user):
    client, profile = user
    slugs = ["peter-piper", "she-sells-seashells", "six-sick-sheiks"]
    for n, slug in enumerate(slugs):
        fav = Favorite.objects.create(profile=profile, twister=Twister.objects.get(slug=slug))
        Favorite.objects.filter(pk=fav.pk).update(created_at=at(2026, 9, 1 + n))
    make_stats(profile, Twister.objects.get(slug=slugs[0]), mastered=True)
    make_attempt(profile, Twister.objects.get(slug=slugs[0]), score=91)

    r = client.get(f"{API}/me/favorites/")
    assert r.status_code == 200
    assert set(r.data) == {"count", "next", "previous", "results"} and r.data["count"] == 3
    assert [t["slug"] for t in r.data["results"]] == slugs[::-1]
    oldest = r.data["results"][-1]
    assert (
        oldest["is_favorite"] is True
        and oldest["mastery"] == "mastered"
        and oldest["best_score"] == 91
    )
    assert {"slug", "text", "category", "difficulty", "difficulty_label", "origin"} <= set(oldest)


def test_list_is_paginated(user):
    client, profile = user
    for tw in Twister.objects.all()[:30]:
        Favorite.objects.create(profile=profile, twister=tw)
    first = client.get(f"{API}/me/favorites/").data
    assert first["count"] == 30 and len(first["results"]) == 24 and first["next"]
    assert len(client.get(f"{API}/me/favorites/?page=2").data["results"]) == 6


def test_list_hides_unpublished_twisters_and_other_peoples_favourites(user):
    client, profile = user
    Favorite.objects.create(profile=profile, twister=Twister.objects.get(slug=SLUG))
    gone = Twister.objects.get(slug="six-sick-sheiks")
    Favorite.objects.create(profile=profile, twister=gone)
    Twister.objects.filter(pk=gone.pk).update(is_published=False)
    Favorite.objects.create(
        profile=new_profile(), twister=Twister.objects.get(slug="sam-sam-sheep")
    )
    assert [t["slug"] for t in client.get(f"{API}/me/favorites/").data["results"]] == [SLUG]


def test_empty_list(user):
    client, _ = user
    assert client.get(f"{API}/me/favorites/").data == {
        "count": 0,
        "next": None,
        "previous": None,
        "results": [],
    }


def test_list_query_count_does_not_grow_with_the_page(user, django_assert_max_num_queries):
    client, profile = user
    for tw in Twister.objects.all()[:24]:
        Favorite.objects.create(profile=profile, twister=tw)
    with django_assert_max_num_queries(9):
        assert len(client.get(f"{API}/me/favorites/").data["results"]) == 24
