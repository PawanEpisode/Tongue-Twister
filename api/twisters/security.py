"""Small security helpers shared by more than one app area: HMAC-signed callbacks and client IPs."""

import hashlib
import hmac

from django.conf import settings
from rest_framework.request import Request

from . import errors

SIGNATURE_HEADER = "X-Worker-Signature"


def require_worker_signature(request: Request) -> None:
    """Authenticate a machine-to-machine callback (scoring or media worker).

    503 when no secret is configured (the feature is simply off, which is not the caller's fault),
    403 for a missing or wrong signature. The signature covers the raw body so it cannot be replayed
    against a different payload; comparison is constant-time.
    """
    secret = settings.WORKER_SHARED_SECRET
    if not secret:
        raise errors.dependency_unavailable("Worker callbacks are not configured.")
    supplied = request.headers.get(SIGNATURE_HEADER, "").removeprefix("sha256=")
    expected = hmac.new(secret.encode(), request.body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(supplied, expected):
        raise errors.ApiProblem(403, "forbidden", "Bad signature.")


def client_ip(request: Request) -> str:
    """Best-effort caller address: the first hop of X-Forwarded-For (set by the platform proxy),
    else REMOTE_ADDR. Only used for throttling and salted hashes, never as an authorisation input."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    first = forwarded.split(",")[0].strip()
    return first or request.META.get("REMOTE_ADDR", "") or "unknown"


def hash_ip(request: Request) -> str:
    """Salted sha256 of the caller's IP: enough to dedupe reports and audit consent without keeping
    the address itself."""
    return hashlib.sha256(f"{settings.IP_HASH_SALT}:{client_ip(request)}".encode()).hexdigest()
