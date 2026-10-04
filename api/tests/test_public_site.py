"""The public (signed-out) site: the curated teaser, the landing payload, demo claims, attribution."""

import datetime as dt
import io
import uuid

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone
from rest_framework.test import APIClient

from twisters.models import (
    Attempt,
    FeatureFlag,
    Profile,
    PublicStatSnapshot,
    SignupAttribution,
    SyncBatch,
    Twister,
)
from twisters.public import teaser

EXPECTED_TEASER = [
    "sam-sam-sheep",
    "fat-frogs",
    "big-black-bug",
    "she-sells-seashells",
    "snake-slithers",
    "unique-new-york",
    "cooks-cook",
    "red-lorry-yellow-lorry",
    "truly-rural",
    "six-sick-sheiks",
    "pad-kid-poured",
    "irish-wristwatch",
]
GOOD = "she sells seashells by the seashore"


def slugs(response):
    return [t["slug"] for t in response.data["results"]]


@pytest.fixture
def anon():
    return APIClient()


@pytest.fixture
def member(seeded, auth_client):
    sub = str(uuid.uuid4())
    client = auth_client(sub)
    client.get("/api/v1/me/")
    return client, Profile.objects.get(pk=sub)


# --- the selection rule (pure) --------------------------------------------------------------------


def rows(spec):
    """spec: (difficulty, category) in catalogue order."""
    return [teaser.Row(i + 1, d, c, i) for i, (d, c) in enumerate(spec)]


def test_rule_takes_first_three_per_level_when_every_family_is_covered():
    spec = [(lvl, fam) for lvl in (1, 2, 3, 4) for fam in "abc"]
    picked = teaser.choose(rows(spec))
    assert [(r.difficulty, r.category) for r in picked] == spec


def test_rule_swaps_in_a_missing_family_replacing_the_most_repeated_pick():
    spec = [(1, "a"), (1, "a"), (1, "b"), (1, "c"), (2, "a"), (2, "b")]
    picked = teaser.choose(rows(spec))
    cats = [r.category for r in picked if r.difficulty == 1]
    assert cats == ["a", "c", "b"]
    assert {r.category for r in picked} == {"a", "b", "c"}


def test_rule_never_drops_the_only_member_of_a_family():
    # Level 1 holds one twister of each of three families; "d" exists only at level 1.
    spec = [(1, "a"), (1, "b"), (1, "c"), (1, "d")]
    picked = teaser.choose(rows(spec))
    assert {r.category for r in picked} == {"a", "b", "c"}  # d stays missing rather than costing b


def test_rule_with_a_short_level_returns_what_exists():
    assert [r.id for r in teaser.choose(rows([(1, "a"), (3, "a")]))] == [1, 2]


@pytest.mark.django_db
def test_seeded_teaser_is_the_decided_twelve(seeded):
    ids = teaser.teaser_ids()
    by_id = dict(Twister.objects.filter(pk__in=ids).values_list("id", "slug"))
    assert [by_id[i] for i in ids] == EXPECTED_TEASER


@pytest.mark.django_db
def test_rule_alone_reproduces_the_curated_twelve(seeded):
    rule = teaser.choose(teaser._rows(Twister.objects.public()))
    by_id = dict(Twister.objects.values_list("id", "slug"))
    assert [by_id[r.id] for r in rule] == EXPECTED_TEASER


@pytest.mark.django_db
def test_teaser_refills_from_the_rule_when_positions_are_missing(seeded):
    Twister.objects.update(teaser_position=None)
    ids = teaser.teaser_ids()
    by_id = dict(Twister.objects.values_list("id", "slug"))
    assert [by_id[i] for i in ids] == EXPECTED_TEASER


@pytest.mark.django_db
def test_teaser_keeps_curated_slots_and_fills_the_rest(seeded):
    Twister.objects.update(teaser_position=None)
    Twister.objects.filter(slug="peter-piper").update(teaser_position=1)
    ids = teaser.teaser_ids()
    by_id = dict(Twister.objects.values_list("id", "slug"))
    assert by_id[ids[0]] == "peter-piper" and len(ids) == 12 and len(set(ids)) == 12


@pytest.mark.django_db
def test_database_refuses_a_private_curated_twister_or_a_taken_slot(seeded):
    from django.db import IntegrityError, transaction

    with pytest.raises(IntegrityError), transaction.atomic():
        Twister.objects.filter(slug="peter-piper").update(teaser_position=2, visibility="private")
    with pytest.raises(IntegrityError), transaction.atomic():
        Twister.objects.filter(slug="peter-piper").update(teaser_position=1)  # slot already taken


# --- GET /twisters/ for signed-out callers --------------------------------------------------------


def test_anonymous_list_is_the_teaser_only(seeded, anon):
    r = anon.get("/api/v1/twisters/")
    assert r.status_code == 200
    assert slugs(r) == EXPECTED_TEASER
    assert r.data["count"] == 12 and r.data["next"] is None and r.data["locked"] is True
    assert r.data["library_total"] == Twister.objects.public().count() > 12
    assert "public" in r["Cache-Control"]


def test_anonymous_filters_and_search_apply_inside_the_teaser(seeded, anon):
    assert len(anon.get("/api/v1/twisters/?difficulty=1").data["results"]) == 3
    assert slugs(anon.get("/api/v1/twisters/?category=rollers")) == [
        "red-lorry-yellow-lorry",
        "truly-rural",
    ]
    assert slugs(anon.get("/api/v1/twisters/?q=lorry")) == ["red-lorry-yellow-lorry"]
    # peter-piper is in the library but not in the teaser, so it cannot be found by searching
    assert anon.get("/api/v1/twisters/?q=peter").data["results"] == []


def test_anonymous_cannot_page_past_the_teaser(seeded, anon):
    r = anon.get("/api/v1/twisters/?page=2")
    assert r.status_code == 401 and r.data["error"]["code"] == "auth_required"
    assert anon.get("/api/v1/twisters/?page=1").status_code == 200


def test_anonymous_sort_and_page_size_cannot_widen_the_teaser(seeded, anon):
    r = anon.get("/api/v1/twisters/?page_size=100&ordering=-word_count&sort=longest")
    assert r.status_code == 200 and slugs(r) == EXPECTED_TEASER


def test_members_still_get_the_whole_library(member):
    client, _ = member
    r = client.get("/api/v1/twisters/")
    assert r.status_code == 200 and r.data["count"] == Twister.objects.public().count()
    assert "locked" not in r.data
    assert client.get("/api/v1/twisters/?page=2").status_code == 200


def test_switching_the_flag_off_restores_guest_first_behaviour(seeded, anon):
    FeatureFlag.objects.filter(code="public_site").update(enabled=False)
    r = anon.get("/api/v1/twisters/")
    assert r.data["count"] == Twister.objects.public().count()
    assert anon.get("/api/v1/twisters/?page=2").status_code == 200


def test_private_twisters_never_enter_the_teaser(seeded, member):
    client, profile = member
    Twister.objects.filter(slug="sam-sam-sheep").update(is_published=False, teaser_position=None)
    ids = teaser.teaser_ids()
    assert not Twister.objects.filter(pk__in=ids, is_published=False).exists()
    assert len(ids) == 12


def test_facets_stay_public_totals(seeded, anon):
    r = anon.get("/api/v1/twisters/facets/")
    assert (
        r.status_code == 200 and sum(r.data["levels"].values()) == Twister.objects.public().count()
    )


def test_anonymous_detail_is_public_but_throttled_per_ip(seeded, anon):
    assert (
        anon.get("/api/v1/twisters/peter-piper/").status_code == 200
    )  # not in the teaser, still readable
    codes = {anon.get("/api/v1/twisters/peter-piper/").status_code for _ in range(70)}
    assert 429 in codes


def test_signed_in_detail_is_not_subject_to_the_public_throttle(member):
    client, _ = member
    assert {client.get("/api/v1/twisters/peter-piper/").status_code for _ in range(70)} == {200}


# --- GET /public/landing/ -------------------------------------------------------------------------


def test_landing_payload(seeded, anon):
    r = anon.get("/api/v1/public/landing/")
    assert r.status_code == 200
    assert [t["slug"] for t in r.data["teaser"]] == EXPECTED_TEASER
    assert r.data["library_total"] == Twister.objects.public().count()
    assert r.data["stats"]["twisters"] == r.data["library_total"]
    assert r.data["stats"]["categories"] == 6 and r.data["stats"]["levels"] == 4
    assert r.data["stats"]["practisers"] is None and r.data["stats"]["attempts"] is None
    assert set(r.data["facets"]) == {"levels", "categories"}
    assert r.data["testimonials"] == []
    assert "s-maxage=300" in r["Cache-Control"]
    assert all(t["best_score"] is None and t["mastery"] is None for t in r.data["teaser"])


def test_landing_is_the_same_for_a_signed_in_caller(member, anon):
    client, _ = member
    assert client.get("/api/v1/public/landing/").data == anon.get("/api/v1/public/landing/").data


def test_usage_numbers_appear_only_above_the_floor(seeded, anon, settings):
    settings.PUBLIC_STAT_FLOOR = 100
    PublicStatSnapshot.objects.update_or_create(key="practisers_30d", defaults={"value": 99})
    PublicStatSnapshot.objects.update_or_create(key="attempts_30d", defaults={"value": 1000})
    s = anon.get("/api/v1/public/landing/").data["stats"]
    assert s["practisers"] is None and s["attempts"] == 1000 and s["as_of"]


def test_refresh_public_stats_counts_recent_practisers(member):
    client, profile = member
    other = Profile.objects.create(email="x@y.co")
    t = Twister.objects.get(slug="peter-piper")
    for p, days in ((profile, 1), (profile, 2), (other, 40)):
        a = Attempt.objects.create(
            profile=p, twister=t, transcript="x", duration_ms=1000, accuracy=0.9, wpm=80, score=80
        )
        Attempt.objects.filter(pk=a.pk).update(created_at=timezone.now() - dt.timedelta(days=days))
    call_command("refresh_public_stats", stdout=io.StringIO())
    assert PublicStatSnapshot.objects.get(key="practisers_30d").value == 1
    assert PublicStatSnapshot.objects.get(key="attempts_30d").value == 2


# --- demo claim -----------------------------------------------------------------------------------


def demo_body(**over):
    attempt = {
        "client_attempt_id": str(uuid.uuid4()),
        "twister": "she-sells-seashells",
        "transcript": GOOD,
        "duration_ms": 4100,
        "created_at": (timezone.now() - dt.timedelta(minutes=3)).isoformat(),
    }
    attempt.update(over.pop("attempt", {}))
    return {
        "client_batch_id": str(uuid.uuid4()),
        "kind": "demo_claim",
        "attempts": [attempt],
        **over,
    }


def test_demo_claim_imports_one_rescored_attempt_without_xp(member):
    client, profile = member
    r = client.post("/api/v1/sync/guest/", demo_body(), format="json")
    assert r.status_code == 201
    assert r.data == {"attempts_imported": 1, "favorites_imported": 0, "rejected": 0}
    profile.refresh_from_db()
    assert (profile.xp, profile.current_streak) == (0, 0)
    mine = Attempt.objects.get(profile=profile)
    assert mine.xp_awarded == 0 and mine.score > 90  # re-scored on the server
    assert SyncBatch.objects.get(profile=profile).kind == "demo_claim"


def test_demo_claim_is_idempotent_for_the_same_batch(member):
    client, profile = member
    body = demo_body()
    assert client.post("/api/v1/sync/guest/", body, format="json").status_code == 201
    again = client.post("/api/v1/sync/guest/", body, format="json")
    assert again.status_code == 200 and again["Idempotent-Replay"] == "true"
    assert Attempt.objects.filter(profile=profile).count() == 1


def test_second_demo_claim_under_a_new_batch_is_declined_not_an_error(member):
    client, profile = member
    client.post("/api/v1/sync/guest/", demo_body(), format="json")
    r = client.post("/api/v1/sync/guest/", demo_body(), format="json")
    assert r.status_code == 200 and r.data["rejected"] == 1
    assert r.data["details"]["reason"] == "demo_already_claimed"
    assert Attempt.objects.filter(profile=profile).count() == 1
    assert SyncBatch.objects.filter(profile=profile, kind="demo_claim").count() == 1


def test_demo_claim_older_than_the_window_is_rejected(member):
    client, profile = member
    old = (timezone.now() - dt.timedelta(hours=25)).isoformat()
    r = client.post("/api/v1/sync/guest/", demo_body(attempt={"created_at": old}), format="json")
    assert r.status_code == 201 and r.data["attempts_imported"] == 0 and r.data["rejected"] == 1


def test_demo_claim_without_a_timestamp_is_rejected(member):
    client, _ = member
    body = demo_body()
    del body["attempts"][0]["created_at"]
    r = client.post("/api/v1/sync/guest/", body, format="json")
    assert r.data["attempts_imported"] == 0 and r.data["rejected"] == 1


@pytest.mark.parametrize(
    "extra",
    [
        {"favorites": ["peter-piper"]},
        {"preferences": {"wpm": 140}},
    ],
)
def test_demo_claim_carries_nothing_but_one_attempt(member, extra):
    client, _ = member
    assert client.post("/api/v1/sync/guest/", demo_body(**extra), format="json").status_code == 400


def test_demo_claim_with_two_attempts_is_a_bad_request(member):
    client, _ = member
    body = demo_body()
    body["attempts"] = body["attempts"] * 2
    assert client.post("/api/v1/sync/guest/", body, format="json").status_code == 400


def test_demo_claim_for_a_private_or_unknown_twister_is_rejected(member):
    client, _ = member
    r = client.post(
        "/api/v1/sync/guest/", demo_body(attempt={"twister": "nope-nope"}), format="json"
    )
    assert r.data["attempts_imported"] == 0 and r.data["rejected"] == 1


def test_a_demo_claim_marks_the_attribution(member):
    client, profile = member
    client.post("/api/v1/me/attribution/", {"intent": "save_demo"}, format="json")
    client.post("/api/v1/sync/guest/", demo_body(), format="json")
    assert SignupAttribution.objects.get(pk=profile.pk).demo_claimed is True


def test_an_attribution_sent_after_a_claim_knows_about_it(member):
    client, profile = member
    client.post("/api/v1/sync/guest/", demo_body(), format="json")
    r = client.post("/api/v1/me/attribution/", {"intent": "save_demo"}, format="json")
    assert r.status_code == 201 and r.data["demo_claimed"] is True


# --- attribution ----------------------------------------------------------------------------------


def test_attribution_is_created_once_and_never_changed(member):
    client, profile = member
    body = {
        "intent": "practise",
        "first_path": "/twisters/peter-piper?utm_source=x#frag",
        "utm": {"source": "X Social!", "medium": "social", "campaign": "launch-2026"},
    }
    r = client.post("/api/v1/me/attribution/", body, format="json")
    assert r.status_code == 201
    assert r.data["first_path"] == "/twisters/peter-piper"  # no query or fragment
    assert r.data["utm"] == {"source": "xsocial", "medium": "social", "campaign": "launch-2026"}
    again = client.post(
        "/api/v1/me/attribution/", {"intent": "hero_cta", "first_path": "/"}, format="json"
    )
    assert again.status_code == 200 and again.data["intent"] == "practise"
    assert SignupAttribution.objects.filter(pk=profile.pk).count() == 1


@pytest.mark.parametrize(
    ("path", "stored"),
    [("https://evil.example/x", ""), ("//evil.example", ""), ("no-slash", ""), ("/ok", "/ok")],
)
def test_attribution_keeps_site_paths_only(member, path, stored):
    client, _ = member
    r = client.post("/api/v1/me/attribution/", {"first_path": path}, format="json")
    assert r.status_code == 201 and r.data["first_path"] == stored


def test_attribution_rejects_an_unknown_intent(member):
    client, _ = member
    assert (
        client.post("/api/v1/me/attribution/", {"intent": "whatever"}, format="json").status_code
        == 400
    )


def test_attribution_needs_an_account(seeded, anon):
    assert anon.post("/api/v1/me/attribution/", {}, format="json").status_code == 401


def test_attribution_goes_with_the_account(member):
    client, profile = member
    client.post("/api/v1/me/attribution/", {"intent": "practise"}, format="json")
    Profile.objects.filter(pk=profile.pk).delete()
    assert not SignupAttribution.objects.filter(pk=profile.pk).exists()


# --- check_public_site ----------------------------------------------------------------------------


def test_check_public_site_passes_on_the_seed(seeded):
    out = io.StringIO()
    call_command("check_public_site", stdout=out)
    assert "Public site OK" in out.getvalue()


def test_check_public_site_fails_when_the_stored_order_drifts(seeded):
    a = Twister.objects.get(teaser_position=1)
    b = Twister.objects.get(teaser_position=2)
    Twister.objects.filter(pk=a.pk).update(teaser_position=None)
    Twister.objects.filter(pk=b.pk).update(teaser_position=1)
    Twister.objects.filter(pk=a.pk).update(teaser_position=2)
    with pytest.raises(CommandError, match="differs from the selection rule"):
        call_command("check_public_site")


def test_check_public_site_fails_for_a_missing_demo_twister(seeded, tmp_path):
    f = tmp_path / "demo.json"
    f.write_text('["she-sells-seashells", "not-a-twister", "peter-piper"]')
    with pytest.raises(CommandError) as err:
        call_command("check_public_site", demo_slugs=str(f))
    assert "not-a-twister is missing" in str(err.value)
    assert "peter-piper is not in the teaser" in str(err.value)


def test_check_public_site_accepts_the_real_demo_slugs(seeded, tmp_path):
    f = tmp_path / "demo.json"
    f.write_text('["she-sells-seashells", "fat-frogs", "sam-sam-sheep"]')
    call_command("check_public_site", demo_slugs=str(f), stdout=io.StringIO())
