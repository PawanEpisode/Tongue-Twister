"""GET /twisters/{slug}/pronunciations/: what the on-device engine scores against (docs/features/13 §3.6)."""

from twisters.models import Twister, TwisterVisibility

from .speak_helpers import SLUG
from .test_speak_trust import model  # noqa: F401  (fixture: an active model and profile)

URL = f"/api/v1/twisters/{SLUG}/pronunciations/"


def test_lists_every_word_with_its_accepted_pronunciations(user, model):  # noqa: F811
    r = user[0].get(URL)
    assert r.status_code == 200
    words = {w["text"]: w["variants"] for w in r.data["words"]}
    assert words["she"] and all(isinstance(p, str) for p in words["she"][0])
    assert r.data["focus"] == sorted(r.data["focus"]) and r.data["scoring_profile"] == "sp-test"
    assert "max-age" in r["Cache-Control"]


def test_works_for_guests_and_without_a_published_model(anon, seeded):
    r = anon.get(URL)
    assert r.status_code == 200 and r.data["scoring_profile"] is None and r.data["words"]


def test_an_unknown_accent_is_a_400_and_a_known_one_a_200(user):
    assert user[0].get(URL + "?lang=klingon").status_code == 400
    assert user[0].get(URL + "?lang=en-IN").status_code == 200


def test_a_private_twister_is_only_visible_to_its_owner(user, auth_client, seeded):
    client, profile = user
    mine = Twister.objects.create(
        text="Red lorry yellow lorry",
        slug="red-lorry-x",
        difficulty=2,
        owner=profile,
        visibility=TwisterVisibility.PRIVATE,
        is_published=False,
        word_count=4,
        origin="user",
    )
    url = f"/api/v1/twisters/{mine.slug}/pronunciations/"
    other = auth_client()
    assert other.get(url).status_code == 404
    r = client.get(url)
    assert r.status_code in (200, 409)
    if r.status_code == 200:
        assert r["Cache-Control"] == "private, no-store"


def test_an_unpronounceable_twister_is_a_409(user, monkeypatch):
    from twisters.speak import jobs

    monkeypatch.setattr(jobs.pronunciations, "resolve", lambda *_: ({}, ["zzz"]))
    r = user[0].get(URL)
    assert r.status_code == 409 and r.data["error"]["code"] == "twister_unscorable"
