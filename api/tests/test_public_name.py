"""Privacy hardening: the opt-in public name, and nothing else, identifies a sharer."""

import pytest
from django.core.exceptions import ValidationError

from twisters.models import Profile
from twisters.names import clean_public_name, validate_public_name

from .media_helpers import API, saved_recording
from .test_media_shares import public, share, token_of


def patch(client, **body):
    return client.patch(f"{API}/me/", body, format="json")


def test_me_exposes_a_blank_public_name_by_default(user):
    client, _ = user
    assert client.get(f"{API}/me/").data["public_name"] == ""


def test_patch_me_sets_and_clears_the_public_name(user):
    client, profile = user
    r = patch(client, public_name="  Sam   the   Sayer ")
    assert r.status_code == 200 and r.data["public_name"] == "Sam the Sayer"
    assert Profile.objects.get(pk=profile.pk).public_name == "Sam the Sayer"
    assert client.get(f"{API}/me/").data["public_name"] == "Sam the Sayer"
    assert patch(client, public_name="").data["public_name"] == ""


def test_other_fields_do_not_touch_the_public_name(user):
    client, profile = user
    patch(client, public_name="Sam")
    patch(client, avatar_emoji="🎤")
    assert Profile.objects.get(pk=profile.pk).public_name == "Sam"


@pytest.mark.parametrize(
    "name",
    [
        "x" * 41,
        "a@b.co",
        "see https://evil.test",
        "www.example",
        "<script>",
        "zero​width",
        "line\nbreak",
        "sh1t",
        "F.U.C.K",
        "Hitler fan",
        "The Admin",
    ],
)
def test_bad_public_names_are_rejected(user, name):
    client, profile = user
    r = patch(client, public_name=name)
    assert r.status_code == 400 and "public_name" in r.data["error"]["details"]
    assert Profile.objects.get(pk=profile.pk).public_name == ""


@pytest.mark.parametrize(
    "name", ["Sam", "Åsa Lindqvist", "李雷", "Grape Drape", "x" * 40, "O'Neil-Smith"]
)
def test_ordinary_names_pass(user, name):
    assert patch(user[0], public_name=name).status_code == 200


def test_the_validators_directly():
    validate_public_name("")
    with pytest.raises(ValidationError):
        validate_public_name("nigga")
    assert clean_public_name("  a \t b\n") == "a b"


def test_public_recording_shows_only_the_public_name(cloud_user, storage, anon):
    client, profile = cloud_user
    Profile.objects.filter(pk=profile.pk).update(display_name="Real Name")
    rec = saved_recording(client, storage)
    link = share(client, rec["id"], expires_in="24h")
    body = public(anon, token_of(link)).data
    assert body["owner"] == {"display_name": None}
    patch(client, public_name="Sam")
    body = public(anon, token_of(link)).data
    assert body["owner"] == {"display_name": "Sam"}
    text = str({k: v for k, v in body.items() if k != "playback"})
    assert "Real Name" not in text and profile.email not in text
    patch(client, public_name="")
    assert public(anon, token_of(link)).data["owner"] == {"display_name": None}


def test_score_cards_show_only_the_opt_in_public_name(cloud_user, anon):
    from .speak_helpers import submit

    client, profile = cloud_user
    patch(client, public_name="Sam")
    attempt = submit(client).data
    r = client.post(f"{API}/attempts/{attempt['id']}/score-card/")
    body = public(anon, r.data["url"].rsplit("/", 1)[1], kind="s").data
    assert body["owner"] == {"display_name": "Sam"}
    assert profile.email not in str(body)


def test_the_public_name_needs_a_signed_in_user(anon, db):
    assert anon.patch(f"{API}/me/", {"public_name": "Sam"}, format="json").status_code in (401, 403)
