import uuid

import jwt
import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

from twisters import scoring

SECRET = "test-secret-test-secret-test-secret"


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.SUPABASE_JWT_SECRET = SECRET


@pytest.fixture
def seeded(db):
    call_command("seed_twisters")


def auth_client():
    token = jwt.encode({"sub": str(uuid.uuid4()), "aud": "authenticated", "email": "a@b.co"}, SECRET, algorithm="HS256")
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
    return c


def test_scoring_perfect_and_bad():
    assert scoring.accuracy("Peter Piper picked", "peter piper picked") == 1.0
    assert scoring.accuracy("Peter Piper picked", "hello world") == 0.0


def test_public_list_and_filters(seeded):
    c = APIClient()
    r = c.get("/api/v1/twisters/?difficulty=1")
    assert r.status_code == 200 and r.data["count"] > 0
    assert all(t["difficulty"] == 1 for t in r.data["results"])
    assert c.get("/api/v1/twisters/daily/").status_code == 200
    assert len(c.get("/api/v1/categories/").data) == 6


def test_attempt_requires_auth(seeded):
    assert APIClient().post("/api/v1/attempts/", {}, format="json").status_code in (401, 403)


def test_attempt_flow_awards_xp_and_streak(seeded):
    c = auth_client()
    r = c.post("/api/v1/attempts/", {"twister": "peter-piper", "transcript": "peter piper picked a peck of pickled peppers", "duration_ms": 3000}, format="json")
    assert r.status_code == 201
    assert r.data["accuracy"] == 1.0 and r.data["personal_best"] is True
    assert r.data["profile"]["current_streak"] == 1 and r.data["profile"]["xp"] > 0
    assert c.get("/api/v1/me/").data["total_attempts"] == 1


def test_marathons_seeded_and_filterable(seeded):
    r = APIClient().get("/api/v1/twisters/?min_words=100")
    assert r.status_code == 200 and r.data["count"] >= 30
    assert all(t["word_count"] >= 100 for t in r.data["results"])


def test_import_command_validates_and_imports(db, tmp_path):
    from django.core.management import call_command
    from django.core.management.base import CommandError

    good = tmp_path / "good.csv"
    good.write_text("text,difficulty,category,origin,tip,focus_sounds\nRed lorry yellow lorry,hard,newcat,classic,tip,r|l\n")
    with pytest.raises(CommandError):
        call_command("import_twisters", str(good))  # unknown category
    call_command("import_twisters", str(good), "--dry-run", "--create-categories")
    from twisters.models import Twister
    assert Twister.objects.count() == 0
    call_command("import_twisters", str(good), "--create-categories")
    assert Twister.objects.get().focus_sounds == ["r", "l"]
    bad = tmp_path / "bad.csv"
    bad.write_text("text,difficulty\nHello world,spicy\n")
    with pytest.raises(CommandError):
        call_command("import_twisters", str(bad))


def test_seed_is_205_and_prune_unpublishes_extras(seeded):
    from twisters.models import Twister
    assert Twister.objects.filter(is_published=True).count() == 205
    Twister.objects.create(slug="legacy-extra", text="Extra one", difficulty=1)
    call_command("seed_twisters", "--prune")
    assert Twister.objects.get(slug="legacy-extra").is_published is False
    assert Twister.objects.filter(is_published=True).count() == 205
