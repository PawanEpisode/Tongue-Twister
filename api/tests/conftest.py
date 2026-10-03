import uuid

import jwt
import pytest
from django.core.cache import cache
from django.core.management import call_command
from rest_framework.test import APIClient

from twisters.models import Profile

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
        sub = sub or str(uuid.uuid4())
        token = jwt.encode(
            # One inbox per account (the sign-up guard refuses a second account for the same inbox), so the
            # email is unique per user; the local part keeps the old display name "a" prefix.
            {"sub": sub, "aud": "authenticated", "email": f"a{sub[:8]}@b.co"},
            SECRET,
            algorithm="HS256",
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return client

    return make


@pytest.fixture(autouse=True)
def _fresh_throttle_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def user(seeded, auth_client):
    """(client, profile) for a signed-in user whose Profile row already exists."""
    sub = str(uuid.uuid4())
    client = auth_client(sub)
    client.get("/api/v1/me/")
    return client, Profile.objects.get(pk=sub)


# --- media (slice 06c) -------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def storage():
    """A fresh in-memory bucket store for every test, so none can reach the network or each other."""
    from twisters.media.storage import get_storage, reset_storage

    reset_storage()
    yield get_storage()
    reset_storage()


@pytest.fixture
def anon(db):
    """An unauthenticated API client (public share pages)."""
    return APIClient()


@pytest.fixture
def cloud_user(user):
    """(client, profile) who may save to the cloud: 13+, consented, with the cloud and share flags on."""
    from twisters.models import AgeBand, ConsentType, FeatureFlag, UserConsent

    client, profile = user
    FeatureFlag.objects.filter(code__in=["record_cloud", "share_links"]).update(enabled=True)
    Profile.objects.filter(pk=profile.pk).update(age_band=AgeBand.ADULT)
    for consent_type in (ConsentType.RECORDING_UPLOAD, ConsentType.VOICE_STORAGE):
        UserConsent.objects.create(profile=profile, type=consent_type, version="v1")
    profile.refresh_from_db()
    return client, profile
