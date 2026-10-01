"""Verify Supabase-issued JWTs and map them to a local Profile."""

import jwt
from django.conf import settings
from jwt import PyJWKClient
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed

from .account import pending
from .models import Profile

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient | None:
    global _jwks_client
    if _jwks_client is None and settings.SUPABASE_URL:
        _jwks_client = PyJWKClient(
            f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json", cache_keys=True
        )
    return _jwks_client


def decode_supabase_token(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "")
        if alg == "HS256":
            if not settings.SUPABASE_JWT_SECRET:
                raise AuthenticationFailed("HS256 token but SUPABASE_JWT_SECRET is not configured")
            key = settings.SUPABASE_JWT_SECRET
            algorithms = ["HS256"]
        else:
            client = _get_jwks_client()
            if client is None:
                raise AuthenticationFailed("SUPABASE_URL is not configured for asymmetric JWTs")
            key = client.get_signing_key_from_jwt(token).key
            algorithms = ["RS256", "ES256"]
        return jwt.decode(
            token, key, algorithms=algorithms, audience=settings.SUPABASE_JWT_AUDIENCE
        )
    except jwt.PyJWTError as exc:
        raise AuthenticationFailed(f"Invalid token: {exc}") from exc


class SupabaseJWTAuthentication(BaseAuthentication):
    keyword = b"bearer"

    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts or parts[0].lower() != self.keyword:
            return None
        if len(parts) != 2:
            raise AuthenticationFailed("Malformed Authorization header")
        claims = decode_supabase_token(parts[1].decode())
        meta = claims.get("user_metadata") or {}
        profile, _ = Profile.objects.get_or_create(
            id=claims["sub"],
            defaults={
                "email": claims.get("email", ""),
                "display_name": (
                    meta.get("full_name")
                    or meta.get("name")
                    or claims.get("email", "").split("@")[0]
                )[:40],
            },
        )
        if not self.accept(request, profile):
            return None
        return profile, claims

    def accept(self, request, profile: Profile) -> bool:
        """Whether this profile may act on this request; raises when a pending account is blocked."""
        pending.guard(request, profile)
        return True

    def authenticate_header(self, request):
        return "Bearer"
