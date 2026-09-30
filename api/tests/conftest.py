import uuid

import jwt
import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

SECRET = "test-secret-test-secret-test-secret"


@pytest.fixture(autouse=True)
def _settings(settings):
    settings.SUPABASE_JWT_SECRET = SECRET


@pytest.fixture
def seeded(db):
    call_command("seed_twisters")


@pytest.fixture
def auth_client(db):
    """Factory: ``auth_client()`` is a new user, ``auth_client(sub)`` a repeat login of the same user."""

    def make(sub: str | None = None) -> APIClient:
        token = jwt.encode({"sub": sub or str(uuid.uuid4()), "aud": "authenticated", "email": "a@b.co"}, SECRET, algorithm="HS256")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return client

    return make
