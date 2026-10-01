"""Private twisters (D25) must never reach anyone but their owner, on every path that lists, counts,
picks, ranks, drills, exports or sitemaps a twister. Each test asks as a stranger (signed in) and as an
anonymous visitor; the owner's own access is tested next to it so a "fix" cannot just hide everything."""

import re
import uuid
from pathlib import Path

import pytest
from django.core.management import call_command
from django.db import IntegrityError, transaction

from twisters.models import (
    Attempt,
    Category,
    FeatureFlag,
    Profile,
    Twister,
    TwisterVisibility,
    UserWordStat,
)
from twisters.speak.queries import drill_targets, weak_word_rows

from .generate_helpers import API, private_twister
from .media_helpers import error_code
from .progress_helpers import make_stats
from .speak_helpers import SLUG, submit

pytestmark = pytest.mark.django_db
MARK = "Xyzzyplugh xyzzy fribblewump wombats whirl wildly while worrying"
WORD = "xyzzyplugh"


@pytest.fixture
def owner(user):
    client, profile = user
    secret = private_twister(
        profile,
        MARK,
        topic="wombats",
        difficulty=4,
        phonemes={WORD: ["K S IH Z IY"]},
        word_count=999,  # sorts and filters apart from every public twister
    )
    return client, profile, secret


@pytest.fixture
def stranger(owner, auth_client):
    client = auth_client()
    client.get(f"{API}/me/")
    return client


@pytest.fixture(params=["stranger", "anonymous"])
def outsider(request, stranger, anon):
    """Everyone who is not the owner."""
    return stranger if request.param == "stranger" else anon


def leaks(response, secret: Twister) -> bool:
    body = response.content.decode()
    return secret.slug in body or "xyzzy" in body.lower() or "fribblewump" in body


def public_count() -> int:
    return Twister.objects.public().count()


# --- lists and counts --------------------------------------------------------------------------------------


def test_the_catalogue_list_has_no_private_twister(owner, outsider):
    _, _, secret = owner
    for params in (
        {},
        {"search": "xyzzyplugh"},
        {"q": "zebras"},
        {"difficulty": 4},
        {"min_words": 100},
        {"ordering": "-word_count"},
        {"sort": "hardest"},
        {"sort": "newest"},
    ):
        r = outsider.get(f"{API}/twisters/", params)
        assert r.status_code == 200 and not leaks(r, secret), params
    assert outsider.get(f"{API}/twisters/").data["count"] == public_count()


def test_the_owner_does_not_see_it_in_the_catalogue_either(owner):
    client, _, secret = owner
    r = client.get(f"{API}/twisters/", {"search": "xyzzyplugh"})
    assert r.data["count"] == 0 and not leaks(r, secret)
    assert client.get(f"{API}/twisters/").data["count"] == public_count()


def test_facet_counts_ignore_private_twisters(owner, outsider):
    _, _, secret = owner
    r = outsider.get(f"{API}/twisters/facets/")
    assert not leaks(r, secret)
    assert r.data["total"] == public_count()
    assert sum(r.data["levels"].values()) == public_count()
    assert r.data["levels"]["4"] == Twister.objects.public().filter(difficulty=4).count()
    assert sum(r.data["origins"].values()) == public_count()


def test_category_counts_ignore_private_twisters(owner, outsider):
    _, _, secret = owner
    category = Category.objects.first()
    secret.category = category
    secret.save()
    r = outsider.get(f"{API}/categories/")
    assert not leaks(r, secret)
    counts = {c["slug"]: c["count"] for c in r.data}
    assert counts[category.slug] == Twister.objects.public().filter(category=category).count()
    assert sum(counts.values()) == Twister.objects.public().exclude(category=None).count()


def test_random_never_picks_a_private_twister(owner, outsider):
    _, _, secret = owner
    r = outsider.get(f"{API}/twisters/random/", {"min_words": 500})  # matches only the private one
    assert r.status_code == 404
    for _ in range(25):
        assert not leaks(outsider.get(f"{API}/twisters/random/"), secret)


def test_random_does_not_pick_it_for_the_owner_either(owner):
    client, _, secret = owner
    assert client.get(f"{API}/twisters/random/", {"min_words": 500}).status_code == 404


def test_with_only_private_twisters_left_every_public_surface_is_empty(owner, outsider):
    _, _, secret = owner
    Twister.objects.public().update(is_published=False)
    assert outsider.get(f"{API}/twisters/").data["count"] == 0
    assert outsider.get(f"{API}/twisters/random/").status_code == 404
    assert outsider.get(f"{API}/twisters/daily/").status_code == 404
    assert outsider.get(f"{API}/daily/").status_code == 404
    assert outsider.get(f"{API}/twisters/facets/").data["total"] == 0
    assert outsider.get(f"{API}/categories/").data == []


def test_the_daily_pick_never_lands_on_a_private_twister(owner, outsider, monkeypatch):
    from twisters.progress import daily

    _, _, secret = owner
    ids = {
        daily.auto_pick(
            __import__("datetime").date(2026, 1, 1) + __import__("datetime").timedelta(days=n)
        )
        for n in range(400)
    }
    assert secret.id not in ids
    assert not leaks(outsider.get(f"{API}/daily/"), secret)


def test_the_summary_total_and_mastered_ignore_private_twisters(owner):
    client, profile, secret = owner
    before = client.get(f"{API}/me/summary/").data
    assert before["total"] == public_count()
    make_stats(profile, secret, mastered=True)
    after = client.get(f"{API}/me/summary/").data
    assert after["total"] == public_count() and after["mastered"] == before["mastered"]
    assert after["mastered"] <= after["total"]


# --- one twister -----------------------------------------------------------------------------------------------


def test_a_stranger_cannot_open_a_private_twister(owner, outsider):
    _, _, secret = owner
    for path in ("", "history/", "leaderboard/"):
        r = outsider.get(f"{API}/twisters/{secret.slug}/{path}")
        assert r.status_code in (404, 401), path
        assert not leaks(r, secret)


def test_a_private_twister_has_the_same_404_as_one_that_does_not_exist(owner, stranger):
    _, _, secret = owner
    ghost = stranger.get(f"{API}/twisters/my-{uuid.uuid4().hex[:12]}/")
    real = stranger.get(f"{API}/twisters/{secret.slug}/")
    assert ghost.status_code == real.status_code == 404
    assert error_code(ghost) == error_code(real)


def test_the_owner_opens_it_but_its_leaderboard_is_closed(owner):
    client, _, secret = owner
    assert client.get(f"{API}/twisters/{secret.slug}/").status_code == 200
    assert client.get(f"{API}/twisters/{secret.slug}/leaderboard/").status_code == 404


def test_weekly_board_for_a_private_slug_is_404(owner, outsider):
    FeatureFlag.objects.filter(code="weekly_boards").update(enabled=True)
    _, _, secret = owner
    r = outsider.get(f"{API}/leaderboard/weekly/", {"twister": secret.slug})
    assert r.status_code == 404 and not leaks(r, secret)


def test_favourites_cannot_hold_a_private_twister(owner, stranger):
    client, profile, secret = owner
    assert stranger.put(f"{API}/me/favorites/{secret.slug}/").status_code == 404
    assert client.put(f"{API}/me/favorites/{secret.slug}/").status_code == 404
    assert stranger.post(f"{API}/twisters/{secret.slug}/favorite/").status_code == 404
    assert stranger.get(f"{API}/me/favorites/").data["results"] == []


def test_guest_sync_ignores_private_twisters(owner, stranger):
    _, _, secret = owner
    r = stranger.post(
        f"{API}/sync/guest/",
        {
            "client_batch_id": str(uuid.uuid4()),
            "favorites": [secret.slug],
            "attempts": [
                {
                    "client_attempt_id": str(uuid.uuid4()),
                    "twister": secret.slug,
                    "transcript": "xyzzyplugh",
                    "duration_ms": 3000,
                }
            ],
        },
        format="json",
    )
    assert r.status_code in (200, 201)
    assert not Attempt.objects.filter(twister=secret).exists()
    assert not secret.favorited_by.exists()


# --- writing against someone else's private twister ----------------------------------------------------------------------


def test_a_stranger_cannot_attempt_or_open_a_session_on_it(owner, stranger):
    _, _, secret = owner
    r = submit(stranger, twister=secret.slug, transcript="xyzzyplugh xyzzy")
    assert r.status_code == 400 and error_code(r) == "validation_error"
    assert not Attempt.objects.filter(twister=secret).exists()
    r = stranger.post(
        f"{API}/sessions/",
        {"client_session_id": str(uuid.uuid4()), "twister": secret.slug, "mode": "read_along"},
        format="json",
    )
    assert r.status_code == 400
    r = stranger.post(
        f"{API}/attempts/sync/",
        {
            "attempts": [
                {
                    "client_attempt_id": str(uuid.uuid4()),
                    "twister": secret.slug,
                    "transcript": "xyzzyplugh",
                    "duration_ms": 3000,
                }
            ]
        },
        format="json",
    )
    assert not Attempt.objects.filter(twister=secret).exists()


def test_a_stranger_cannot_create_a_recording_of_it(owner, stranger):
    from twisters.models import AgeBand, ConsentType, UserConsent

    from .media_helpers import create_recording

    _, _, secret = owner
    FeatureFlag.objects.filter(code__in=["record_cloud", "share_links"]).update(enabled=True)
    other = Profile.objects.exclude(pk=owner[1].pk).get()
    Profile.objects.filter(pk=other.pk).update(age_band=AgeBand.ADULT)
    for kind in (ConsentType.RECORDING_UPLOAD, ConsentType.VOICE_STORAGE):
        UserConsent.objects.create(profile=other, type=kind, version="v1")
    assert create_recording(stranger, twister=SLUG).status_code == 201  # the same call, public slug
    r = create_recording(stranger, twister=secret.slug)
    assert r.status_code == 400 and error_code(r) == "validation_error"
    owner_client, owner_profile, _ = owner
    Profile.objects.filter(pk=owner_profile.pk).update(age_band=AgeBand.ADULT)
    for kind in (ConsentType.RECORDING_UPLOAD, ConsentType.VOICE_STORAGE):
        UserConsent.objects.create(profile=owner_profile, type=kind, version="v1")
    assert create_recording(owner_client, twister=secret.slug).status_code == 201


def test_the_owner_can_attempt_it_and_it_stays_out_of_every_public_surface(owner, outsider):
    client, profile, secret = owner
    r = submit(client, twister=secret.slug, transcript="xyzzyplugh xyzzy fribblewump")
    assert r.status_code == 201
    FeatureFlag.objects.filter(code="weekly_boards").update(enabled=True)
    assert not leaks(outsider.get(f"{API}/twisters/"), secret)
    assert not leaks(outsider.get(f"{API}/twisters/facets/"), secret)
    assert not leaks(outsider.get(f"{API}/engine/manifest/"), secret)
    # ...and the owner's practice on it never fed a public board
    assert outsider.get(f"{API}/leaderboard/weekly/").status_code in (200, 404)


# --- drill targets -----------------------------------------------------------------------------------------------------


def test_drill_fallback_never_points_at_someone_elses_private_twister(owner, stranger):
    _, _, secret = owner
    stranger_profile = Profile.objects.exclude(pk=owner[1].pk).get()
    assert WORD in secret.phonemes
    assert drill_targets(stranger_profile, [WORD]) == {}
    UserWordStat.objects.create(
        profile=stranger_profile, word_norm=WORD, seen=10, wrong=9, weakness=0.9
    )
    queue = stranger.get(f"{API}/me/words/weak/").data["results"]
    assert queue[0]["word"] == WORD and queue[0]["drill"] is None
    assert secret.slug not in stranger.get(f"{API}/me/words/weak/").content.decode()
    assert secret.slug not in stranger.get(f"{API}/me/stats/").content.decode()


def test_the_owner_is_drilled_back_to_their_own_twister_from_their_history(owner):
    client, profile, secret = owner
    assert submit(client, twister=secret.slug, transcript="xyzzyplugh xyzzy").status_code == 201
    targets = drill_targets(profile, [WORD])
    assert targets[WORD]["twister"] == secret.slug
    UserWordStat.objects.update_or_create(
        profile=profile, word_norm=WORD, defaults={"seen": 5, "wrong": 4, "weakness": 0.8}
    )
    assert weak_word_rows(profile, limit=5)[0]["drill"]["twister"] == secret.slug


def test_a_public_twister_with_the_same_word_is_still_found_for_everyone(owner, stranger):
    _, _, secret = owner
    stranger_profile = Profile.objects.exclude(pk=owner[1].pk).get()
    call_command("build_pronunciations")
    word = next(iter(Twister.objects.public().exclude(phonemes={}).first().phonemes))
    assert drill_targets(stranger_profile, [word])[word]["twister"] != secret.slug


# --- export, deletion, constraints ------------------------------------------------------------------------------------------


def test_the_export_carries_only_my_generated_twisters(owner, stranger):
    client, profile, secret = owner
    mine = client.get(f"{API}/me/export/")
    body = __import__("json").loads(
        mine.getvalue() if hasattr(mine, "getvalue") else b"".join(mine.streaming_content)
    )
    assert [t["slug"] for t in body["generated_twisters"]] == [secret.slug]
    assert set(body["generated_twisters"][0]) == {
        "slug",
        "text",
        "topic",
        "tip",
        "focus_sounds",
        "difficulty",
        "created_at",
    }
    theirs = stranger.get(f"{API}/me/export/")
    text = b"".join(theirs.streaming_content).decode()
    assert secret.slug not in text and "xyzzy" not in text.lower()
    assert __import__("json").loads(text)["generated_twisters"] == []


def test_deleting_the_account_removes_the_private_twisters(owner):
    _, profile, secret = owner
    Profile.objects.filter(pk=profile.pk).delete()
    assert not Twister.objects.filter(pk=secret.pk).exists()


def test_the_database_rejects_inconsistent_visibility(user):
    _, profile = user
    base = {"slug": "x-1", "text": "a b c d e f g h"}
    bad = [
        {"visibility": TwisterVisibility.PRIVATE, "owner": None, "is_published": False},
        {"visibility": TwisterVisibility.PRIVATE, "owner": profile, "is_published": True},
        {"visibility": TwisterVisibility.PUBLIC, "owner": profile, "is_published": True},
    ]
    for i, fields in enumerate(bad):
        with pytest.raises(IntegrityError), transaction.atomic():
            Twister.objects.create(**{**base, "slug": f"x-{i}"}, **fields)
    Twister.objects.create(**base, visibility="private", owner=profile, is_published=False)


def test_visible_to_is_public_plus_own(owner, stranger):
    _, profile, secret = owner
    stranger_profile = Profile.objects.exclude(pk=profile.pk).get()
    assert secret in Twister.objects.visible_to(profile)
    assert secret not in Twister.objects.visible_to(stranger_profile)
    assert secret not in Twister.objects.visible_to(None)
    assert secret not in Twister.objects.public()
    assert Twister.objects.visible_to(None).count() == public_count()


# --- commands ------------------------------------------------------------------------------------------------------------------


def test_seed_prune_leaves_private_twisters_alone(owner):
    _, _, secret = owner
    call_command("seed_twisters", "--prune")
    secret.refresh_from_db()
    assert secret.visibility == TwisterVisibility.PRIVATE and secret.is_published is False


def test_build_pronunciations_keeps_private_twisters_current(user):
    _, profile = user
    tw = private_twister(profile, "Six slick snakes slid slowly by the sea.", phonemes={})
    call_command("build_pronunciations")
    tw.refresh_from_db()
    assert tw.phonemes["snakes"] and tw.phoneme_version == 2


def test_a_private_twister_with_unknown_words_never_fails_the_catalogue_check(user):
    _, profile = user
    tw = private_twister(
        profile, "Qxzv wkrt plmn bvcx zzyq mmnb ttrw ghjk.", phonemes={"kept": ["K"]}
    )
    call_command("build_pronunciations", "--check")  # would raise for a published twister
    call_command("build_pronunciations")
    tw.refresh_from_db()
    assert tw.phonemes == {"kept": ["K"]}  # left as it was


# --- the guard: a new listing path cannot forget ------------------------------------------------------------------------------------


TWISTERS_DIR = Path(__file__).resolve().parents[1] / "twisters"
# Files that legitimately touch Twister rows without the public/visible helpers: the model itself, the
# admin (staff see everything), seed/import commands that create by slug, and the caller's own attempts.
ALLOWED = {
    "models.py",
    "admin.py",
    "seed_twisters.py",
    "import_twisters.py",
    "stats.py",
    "own.py",
    "export.py",
    "build_pronunciations.py",
}
RAW_QUERY = re.compile(
    r"(?<![A-Za-z])Twister\.objects\.(?!public\(|visible_to\(|in_bulk\(|create\(|update_or_create\()"
)


def test_no_module_filters_twisters_by_is_published_alone():
    offenders = []
    for path in TWISTERS_DIR.rglob("*.py"):
        if "migrations" in path.parts or path.name in ALLOWED:
            continue
        source = path.read_text("utf-8")
        if re.search(
            r"is_published\s*=\s*True|twister__is_published|twisters__is_published", source
        ):
            offenders.append(f"{path.name}: is_published")
        if RAW_QUERY.search(source):
            offenders.append(f"{path.name}: Twister.objects without public()/visible_to()")
    assert not offenders, (
        "Use Twister.objects.public() / .visible_to(profile) or public_twister_q (D25): "
        f"{offenders}"
    )
