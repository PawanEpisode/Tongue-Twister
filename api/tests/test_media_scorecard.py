"""Score-card images (D20): the pure renderer, the public image endpoint and its parity with the JSON one."""

import dataclasses
import datetime as dt
import io
import logging

import pytest
from django.utils import timezone
from PIL import Image

from twisters.media import scorecard
from twisters.models import FeatureFlag, Profile, ShareLink

from .media_helpers import API, error_code, saved_recording
from .speak_helpers import submit

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
DIMENSIONS = {"og": (1200, 630), "square": (1080, 1080)}
TEXT = "She sells seashells by the seashore."


def payload(**over) -> scorecard.ScoreCardPayload:
    base = dict(score=87, accuracy=0.93, wpm=132.4, twister_text=TEXT, owner_name=None)
    return scorecard.ScoreCardPayload(**{**base, **over})


def open_png(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


# --- the pure renderer ------------------------------------------------------------------------------------


@pytest.mark.parametrize("size", scorecard.SIZES)
def test_the_render_is_a_png_of_the_exact_size(size):
    data = scorecard.render(payload(), size)
    assert data.startswith(PNG_MAGIC)
    image = open_png(data)
    assert (image.format, image.size) == ("PNG", DIMENSIONS[size])


@pytest.mark.parametrize("size", scorecard.SIZES)
def test_the_picture_is_not_blank(size):
    image = open_png(scorecard.render(payload(), size)).convert("RGB")
    colours = image.getcolors(maxcolors=image.width * image.height)
    assert len(colours) >= 3


def test_the_default_size_is_og():
    assert scorecard.DEFAULT_SIZE == "og"
    assert scorecard.render(payload()) == scorecard.render(payload(), "og")


def test_rendering_is_deterministic():
    assert scorecard.render(payload(owner_name="Sam"), "og") == scorecard.render(
        payload(owner_name="Sam"), "og"
    )


def test_an_unknown_size_is_refused():
    with pytest.raises(KeyError):
        scorecard.render(payload(), "huge")


@pytest.mark.parametrize(
    "text",
    [
        "word " * 2000,
        "a" * 600,  # one unbreakable word far wider than the card
        "café — 你好 \U0001f3a4 שלום مرحبا é",
        "",
        "   \n\t  ",
        "‮\u0000mixed​ controls",
    ],
    ids=["long", "monster-word", "unicode", "empty", "whitespace", "controls"],
)
@pytest.mark.parametrize("size", scorecard.SIZES)
def test_hostile_text_never_crashes_and_keeps_the_size(text, size):
    data = scorecard.render(payload(twister_text=text, owner_name=text[:200] or None), size)
    assert open_png(data).size == DIMENSIONS[size]


@pytest.mark.parametrize("score", [0, 1, 50, 69, 70, 89, 90, 100])
def test_every_score_renders(score):
    assert open_png(scorecard.render(payload(score=score))).size == DIMENSIONS["og"]


def test_the_owner_name_is_drawn_only_when_there_is_one():
    anonymous = scorecard.render(payload(owner_name=None))
    named = scorecard.render(payload(owner_name="Sam"))
    assert anonymous != named


def test_excerpt_is_short_normalised_and_ends_with_an_ellipsis():
    assert scorecard.excerpt("  a \n b\t c ") == "a b c"
    long = scorecard.excerpt("word " * 100)
    assert len(long) <= scorecard.EXCERPT_MAX_CHARS and long.endswith(scorecard.ELLIPSIS)
    exact = "x" * scorecard.EXCERPT_MAX_CHARS
    assert scorecard.excerpt(exact) == exact


def test_wrapping_respects_the_width_and_the_line_limit():
    font = scorecard._font(False, 40)
    lines = scorecard.wrap("word " * 200, font, 600, 4)
    assert len(lines) == 4 and lines[-1].endswith(scorecard.ELLIPSIS)
    assert all(font.getlength(line) <= 600 * scorecard.SUPERSAMPLE for line in lines)
    monster = scorecard.wrap("x" * 500, font, 600, 5)
    assert all(font.getlength(line) <= 600 * scorecard.SUPERSAMPLE for line in monster)


def test_the_etag_is_strong_stable_and_tracks_every_input():
    base = scorecard.etag_for(payload(), "og")
    assert base == scorecard.etag_for(payload(), "og")
    assert base.startswith('"') and base.endswith('"') and not base.startswith("W/")
    variants = [
        scorecard.etag_for(payload(), "square"),
        scorecard.etag_for(payload(score=88), "og"),
        scorecard.etag_for(payload(accuracy=0.5), "og"),
        scorecard.etag_for(payload(wpm=100), "og"),
        scorecard.etag_for(payload(twister_text="other"), "og"),
        scorecard.etag_for(payload(owner_name="Sam"), "og"),
    ]
    assert len({base, *variants}) == len(variants) + 1


def test_the_payload_has_no_room_for_personal_data():
    assert {f.name for f in dataclasses.fields(scorecard.ScoreCardPayload)} == {
        "score",
        "accuracy",
        "wpm",
        "twister_text",
        "owner_name",
    }


def test_the_bundled_fonts_and_their_licence_ship_with_the_app():
    for name in ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "LICENSE.txt"):
        assert (scorecard.FONT_DIR / name).is_file(), name
    assert "Bitstream" in (scorecard.FONT_DIR / "LICENSE.txt").read_text()


# --- the endpoint ------------------------------------------------------------------------------------------


def image_url(token: str, **params) -> str:
    query = "".join(f"&{k}={v}" for k, v in params.items()).replace("&", "?", 1)
    return f"{API}/public/s/{token}/image.png{query}"


@pytest.fixture
def card(cloud_user):
    """(client, profile, token, link id) for a fresh score card."""
    client, profile = cloud_user
    attempt = submit(client, transcript="she shells seashells by the seashore").data
    made = client.post(f"{API}/attempts/{attempt['id']}/score-card/")
    assert made.status_code == 201
    return client, profile, made.data["url"].rsplit("/", 1)[1], made.data["id"]


def test_the_image_is_served_with_cache_and_robots_headers(card, anon):
    _, _, token, _ = card
    r = anon.get(image_url(token))
    assert r.status_code == 200 and r["Content-Type"] == "image/png"
    assert r["Cache-Control"] == "public, max-age=3600"
    assert r["X-Robots-Tag"] == "noindex, nofollow"
    assert r["ETag"].startswith('"') and not r["ETag"].startswith("W/")
    assert r.content.startswith(PNG_MAGIC) and open_png(r.content).size == DIMENSIONS["og"]


@pytest.mark.parametrize("size", scorecard.SIZES)
def test_both_sizes(card, anon, size):
    _, _, token, _ = card
    assert open_png(anon.get(image_url(token, size=size)).content).size == DIMENSIONS[size]


def test_the_endpoint_defaults_to_the_og_size(card, anon):
    _, _, token, _ = card
    assert anon.get(image_url(token)).content == anon.get(image_url(token, size="og")).content


@pytest.mark.parametrize("size", ["huge", "", "OG", "1200x630", "og,square"])
def test_any_other_size_is_a_400(card, anon, size):
    _, _, token, _ = card
    r = anon.get(image_url(token, size=size))
    assert r.status_code == 400 and error_code(r) == "validation_error"
    assert r["Cache-Control"] == "no-store"


def test_a_matching_etag_gets_304_and_no_body(card, anon):
    _, _, token, _ = card
    etag = anon.get(image_url(token))["ETag"]
    for header in (etag, f"W/{etag}", f'"nope", {etag}', "*"):
        r = anon.get(image_url(token), HTTP_IF_NONE_MATCH=header)
        assert r.status_code == 304 and r.content == b"", header
        assert r["ETag"] == etag and r["Cache-Control"] == "public, max-age=3600"
    assert anon.get(image_url(token), HTTP_IF_NONE_MATCH='"stale"').status_code == 200


def test_the_etag_is_per_size(card, anon):
    _, _, token, _ = card
    og = anon.get(image_url(token, size="og"))["ETag"]
    square = anon.get(image_url(token, size="square"))
    assert square["ETag"] != og
    assert anon.get(image_url(token, size="square"), HTTP_IF_NONE_MATCH=og).status_code == 200


def test_the_etag_changes_when_the_public_name_does(card, anon):
    client, _, token, _ = card
    before = anon.get(image_url(token))["ETag"]
    client.patch(f"{API}/me/", {"public_name": "Sam"}, format="json")
    after = anon.get(image_url(token), HTTP_IF_NONE_MATCH=before)
    assert after.status_code == 200 and after["ETag"] != before


@pytest.mark.parametrize(
    "accept", ["image/png", "image/avif,image/webp,*/*;q=0.8", "text/html", "application/xml"]
)
def test_the_accept_header_cannot_turn_the_picture_into_a_406(card, anon, accept):
    _, _, token, _ = card
    assert anon.get(image_url(token), HTTP_ACCEPT=accept).status_code == 200


def test_fetching_the_image_does_not_count_as_a_view(card, anon):
    _, _, token, _ = card
    anon.get(image_url(token))
    assert ShareLink.objects.get().view_count == 0
    anon.get(f"{API}/public/s/{token}/")
    assert ShareLink.objects.get().view_count == 1


def test_the_image_is_throttled_like_the_json_endpoint(card, anon):
    _, _, token, _ = card
    etag = anon.get(image_url(token))["ETag"]
    codes = [anon.get(image_url(token), HTTP_IF_NONE_MATCH=etag).status_code for _ in range(60)]
    assert codes[-1] == 429 and codes.count(304) == 59
    assert (
        anon.get(image_url(token), HTTP_IF_NONE_MATCH=etag).data["error"]["code"] == "rate_limited"
    )


def test_tokens_never_reach_the_logs(card, anon, caplog):
    _, _, token, _ = card
    with caplog.at_level(logging.DEBUG):
        anon.get(image_url(token))
        anon.get(image_url("x" * 22))
    assert token not in caplog.text


# --- parity with the JSON endpoint -------------------------------------------------------------------------


def statuses(anon, token, **params) -> tuple[int, int]:
    return (
        anon.get(f"{API}/public/s/{token}/").status_code,
        anon.get(image_url(token, **params)).status_code,
    )


def test_unknown_tokens_are_404_on_both(card, anon):
    assert statuses(anon, "u" * 22) == (404, 404)


def test_a_recording_link_is_not_a_score_card(cloud_user, storage, anon):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    link = client.post(f"{API}/recordings/{rec['id']}/share/", {"expires_in": "24h"}, format="json")
    assert statuses(anon, link.data["url"].rsplit("/", 1)[1]) == (404, 404)


def test_revoked_expired_and_deleted_are_410_on_both(card, anon):
    client, _, token, link_id = card
    assert statuses(anon, token) == (200, 200)
    ShareLink.objects.filter(pk=link_id).update(expires_at=timezone.now() - dt.timedelta(seconds=1))
    assert statuses(anon, token) == (410, 410)
    ShareLink.objects.filter(pk=link_id).update(
        expires_at=timezone.now() + dt.timedelta(days=1), hidden_at=timezone.now()
    )
    assert statuses(anon, token) == (410, 410)
    ShareLink.objects.filter(pk=link_id).update(hidden_at=None)
    assert client.delete(f"{API}/shares/{link_id}/").status_code in (200, 204)
    assert statuses(anon, token) == (410, 410)


def test_a_deleted_attempt_is_410_on_both(cloud_user, anon):
    client, _ = cloud_user
    attempt = submit(client).data["id"]
    token = client.post(f"{API}/attempts/{attempt}/score-card/").data["url"].rsplit("/", 1)[1]
    client.delete(f"{API}/attempts/{attempt}/")
    assert statuses(anon, token) == (410, 410)


def test_errors_are_never_cacheable(card, anon):
    _, _, token, link_id = card
    assert anon.get(image_url("u" * 22))["Cache-Control"] == "no-store"
    ShareLink.objects.filter(pk=link_id).update(revoked_at=timezone.now())
    assert anon.get(image_url(token))["Cache-Control"] == "no-store"


# --- the flag (D20) ----------------------------------------------------------------------------------------


def test_score_cards_work_with_share_links_off(cloud_user, anon):
    client, _ = cloud_user
    FeatureFlag.objects.filter(code="share_links").update(enabled=False)
    attempt = submit(client).data["id"]
    made = client.post(f"{API}/attempts/{attempt}/score-card/")
    assert made.status_code == 201
    token = made.data["url"].rsplit("/", 1)[1]
    assert statuses(anon, token) == (200, 200)


def test_the_kill_switch_is_score_cards_not_share_links(card, anon):
    client, _, token, _ = card
    FeatureFlag.objects.filter(code="score_cards").update(enabled=False)
    for response in (anon.get(f"{API}/public/s/{token}/"), anon.get(image_url(token))):
        assert response.status_code == 403 and error_code(response) == "feature_disabled"
    attempt = submit(client).data["id"]
    assert client.post(f"{API}/attempts/{attempt}/score-card/").status_code == 403


def test_recordings_keep_their_own_flag(cloud_user, storage, anon):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    FeatureFlag.objects.filter(code="score_cards").update(enabled=False)
    link = client.post(f"{API}/recordings/{rec['id']}/share/", {"expires_in": "24h"}, format="json")
    assert link.status_code == 201  # recordings are gated by share_links alone


def test_the_flag_is_seeded_on(db):
    assert FeatureFlag.objects.get(code="score_cards").enabled is True


# --- what the image is drawn from --------------------------------------------------------------------------


def test_the_renderer_only_ever_sees_the_public_payload(card, anon, monkeypatch):
    client, profile, token, _ = card
    Profile.objects.filter(pk=profile.pk).update(display_name="Real Name", public_name="")
    seen = []
    real = scorecard.render
    monkeypatch.setattr(scorecard, "render", lambda p, size: seen.append(p) or real(p, size))

    anon.get(image_url(token))
    client.patch(f"{API}/me/", {"public_name": "Sam"}, format="json")
    anon.get(image_url(token))

    assert [p.owner_name for p in seen] == [None, "Sam"]
    for p in seen:
        text = str(dataclasses.asdict(p))
        assert profile.email not in text and "Real Name" not in text
        assert str(profile.pk) not in text


# --- the JSON endpoint's additions ---------------------------------------------------------------------------


def test_the_json_carries_image_urls_and_the_public_name(card, anon, settings):
    client, _, token, _ = card
    settings.API_PUBLIC_URL = "https://api.example.com"
    body = anon.get(f"{API}/public/s/{token}/").data
    assert body["images"] == {
        "og": f"https://api.example.com/api/v1/public/s/{token}/image.png?size=og",
        "square": f"https://api.example.com/api/v1/public/s/{token}/image.png?size=square",
    }
    assert body["owner"] == {"display_name": None}
    client.patch(f"{API}/me/", {"public_name": "Sam"}, format="json")
    assert anon.get(f"{API}/public/s/{token}/").data["owner"] == {"display_name": "Sam"}


def test_without_a_public_url_the_images_block_is_omitted(card, anon, settings):
    _, _, token, _ = card
    settings.API_PUBLIC_URL = ""
    assert "images" not in anon.get(f"{API}/public/s/{token}/").data


def test_the_advertised_url_actually_serves_the_picture(card, anon, settings):
    _, _, token, _ = card
    settings.API_PUBLIC_URL = "http://testserver"
    url = anon.get(f"{API}/public/s/{token}/").data["images"]["square"]
    assert open_png(anon.get(url.removeprefix("http://testserver")).content).size == (1080, 1080)
