"""Editable identity (display name, avatar) and the synced appearance preferences."""

import pytest
from django.core.exceptions import ValidationError

from twisters.avatars import validate_avatar_emoji
from twisters.models import Profile, UserPreference
from twisters.names import validate_display_name

from .media_helpers import API


def patch_me(client, **body):
    return client.patch(f"{API}/me/", body, format="json")


def patch_prefs(client, **body):
    return client.patch(f"{API}/me/preferences/", body, format="json")


# --- pure validators ---------------------------------------------------------------------------


@pytest.mark.parametrize("emoji", ["🎤", "🗣️", "👩🏽‍🎤", "🇮🇳", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "🐙", "❤️"])
def test_real_emoji_are_accepted(emoji):
    validate_avatar_emoji(emoji)


@pytest.mark.parametrize(
    "value", ["", "  ", "a", "ab", "1", "<b>", "hi 🎤", "🎤🎤🎤🎤🎤🎤🎤🎤🎤", "\n", "🎤\u0000", "$"]
)
def test_anything_else_is_not_an_avatar(value):
    with pytest.raises(ValidationError):
        validate_avatar_emoji(value)


@pytest.mark.parametrize("name", ["Sam", "Sam Sayer", "José", "李雷", "O'Brien"])
def test_ordinary_display_names_pass(name):
    validate_display_name(name)


@pytest.mark.parametrize(
    "name", ["", " ", "S", "x" * 41, "a@b.co", "see https://x.test", "<i>", "sh1t", "The Admin"]
)
def test_unsafe_or_empty_display_names_fail(name):
    with pytest.raises(ValidationError):
        validate_display_name(name)


# --- PATCH /me/ ----------------------------------------------------------------------------------


def test_me_exposes_the_avatar_source_with_the_photo_as_default(user):
    client, _ = user
    body = client.get(f"{API}/me/").data
    assert body["avatar_source"] == "photo"
    assert body["avatar_emoji"] == "🗣️"


def test_patch_me_renames_and_canonicalises(user):
    client, profile = user
    r = patch_me(client, display_name="  Sam   the   Sayer ")
    assert r.status_code == 200 and r.data["display_name"] == "Sam the Sayer"
    assert Profile.objects.get(pk=profile.pk).display_name == "Sam the Sayer"


@pytest.mark.parametrize("name", ["", "S", "x" * 41, "a@b.co", "<script>", "sh1t"])
def test_bad_display_names_are_rejected_and_nothing_changes(user, name):
    client, profile = user
    before = Profile.objects.get(pk=profile.pk).display_name
    r = patch_me(client, display_name=name)
    assert r.status_code == 400 and "display_name" in r.data["error"]["details"]
    assert Profile.objects.get(pk=profile.pk).display_name == before


def test_patch_me_picks_an_emoji_and_the_avatar_source(user):
    client, profile = user
    r = patch_me(client, avatar_emoji="🎤", avatar_source="emoji")
    assert r.status_code == 200
    assert (r.data["avatar_emoji"], r.data["avatar_source"]) == ("🎤", "emoji")
    stored = Profile.objects.get(pk=profile.pk)
    assert (stored.avatar_emoji, stored.avatar_source) == ("🎤", "emoji")


@pytest.mark.parametrize(
    "body", [{"avatar_emoji": "abc"}, {"avatar_emoji": ""}, {"avatar_source": "url"}]
)
def test_bad_avatars_are_rejected(user, body):
    client, profile = user
    r = patch_me(client, **body)
    assert r.status_code == 400
    assert Profile.objects.get(pk=profile.pk).avatar_emoji == "🗣️"


def test_identity_cannot_be_edited_while_deletion_is_pending(user):
    client, _ = user
    assert client.delete(f"{API}/me/", {"confirm": "DELETE"}, format="json").status_code == 202
    r = patch_me(client, display_name="New Name")
    assert r.status_code == 403 and r.data["error"]["code"] == "account_pending_deletion"


# --- preferences: theme and confetti ---------------------------------------------------------------


def test_theme_starts_unchosen_and_confetti_on(user):
    client, _ = user
    body = client.get(f"{API}/me/preferences/").data
    assert body["theme"] == "" and body["confetti"] is True


@pytest.mark.parametrize("theme", ["system", "light", "dark", "reading"])
def test_every_theme_can_be_saved_and_read_back(user, theme):
    client, profile = user
    assert patch_prefs(client, theme=theme).data["theme"] == theme
    assert UserPreference.objects.get(profile=profile).theme == theme
    assert client.get(f"{API}/me/preferences/").data["theme"] == theme


def test_an_unknown_theme_is_rejected(user):
    client, _ = user
    r = patch_prefs(client, theme="neon")
    assert r.status_code == 400 and "theme" in r.data["error"]["details"]


def test_confetti_can_be_turned_off_without_touching_other_settings(user):
    client, profile = user
    patch_prefs(client, wpm=120)
    assert patch_prefs(client, confetti=False).data["confetti"] is False
    stored = UserPreference.objects.get(profile=profile)
    assert stored.confetti is False and stored.wpm == 120


def test_the_data_export_carries_the_new_fields(user):
    client, _ = user
    patch_me(client, avatar_emoji="🎤", avatar_source="emoji")
    patch_prefs(client, theme="reading", confetti=False)
    from twisters.account import export

    assert "avatar_source" in dict(export.PROFILE)
    assert {"theme", "confetti"} <= set(dict(export.PREFERENCES))
