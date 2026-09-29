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
