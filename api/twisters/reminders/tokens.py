"""Signed unsubscribe tokens (RFC 8058 one-click, D27).

A token is the profile id signed with the project secret under a dedicated salt: it cannot be forged,
carries nothing but the id, and does not expire (an old e-mail must still unsubscribe). It is URL-safe
(base64url, ``.`` before the signature), so it needs no escaping in a path. Rotating ``SECRET_KEY``
invalidates every token already mailed; the people concerned can still switch reminders off in the app.
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.core import signing

SALT = "twister.reminders.unsubscribe"


def _signer() -> signing.Signer:
    return signing.Signer(salt=SALT, sep=".")


def make_token(profile_id: uuid.UUID | str) -> str:
    return _signer().sign_object({"p": str(profile_id)}, compress=False)


def read_token(token: str) -> uuid.UUID | None:
    """The profile id inside a valid token, else ``None`` (tampered, truncated, wrong salt or key)."""
    try:
        payload = _signer().unsign_object(token)
        return uuid.UUID(payload["p"])
    except (signing.BadSignature, KeyError, TypeError, ValueError):
        return None


def web_url(token: str) -> str:
    """The page people see (``/unsubscribe/$token`` on the web app)."""
    return f"{settings.WEB_BASE_URL}/unsubscribe/{token}"


def api_url(token: str) -> str:
    """The endpoint a mail client POSTs to for one-click unsubscribe."""
    return f"{settings.API_PUBLIC_URL}/api/v1/public/unsubscribe/{token}/"
