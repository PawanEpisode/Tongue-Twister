"""Small security helpers shared by more than one app area: HMAC-signed callbacks and client IPs."""

import hashlib
import hmac
import time

from django.conf import settings
from rest_framework.request import Request

from . import errors

SIGNATURE_HEADER = "X-Worker-Signature"
TIMESTAMP_HEADER = "X-Worker-Timestamp"


def worker_signature(secret: str, body: bytes, timestamp: int | str | None = None) -> str:
    """Hex HMAC-SHA256 the worker must send: over `f"{timestamp}." + body`, or over the body alone for
    the legacy scheme (`timestamp=None`). The single definition both the verifier and the tests use."""
    message = body if timestamp is None else f"{timestamp}.".encode() + body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def require_worker_signature(request: Request) -> None:
    """Authenticate a machine-to-machine callback (scoring or media worker).

    503 when no secret is configured (the feature is simply off, which is not the caller's fault),
    403 for a missing or wrong signature. The signature covers a unix timestamp and the raw body, so it
    cannot be moved to a different payload and goes stale after `WORKER_SIGNATURE_MAX_SKEW_S`.
    Comparison is constant-time.

    A request *without* `X-Worker-Timestamp` is verified as the legacy body-only signature, and only
    while `WORKER_ALLOW_LEGACY_SIGNATURE` is on (so a worker and API can be deployed in either order).
    A request *with* a timestamp is never downgraded to the legacy check.

    Replay inside the window is NOT prevented: the API is stateless serverless and keeps no nonce
    cache (documented in docs/runbooks/secrets-and-rotation.md). The endpoints are idempotent.
    """
    secret = settings.WORKER_SHARED_SECRET
    if not secret:
        raise errors.dependency_unavailable("Worker callbacks are not configured.")
    supplied = request.headers.get(SIGNATURE_HEADER, "").removeprefix("sha256=")
    timestamp = request.headers.get(TIMESTAMP_HEADER)
    if timestamp is None:
        if not settings.WORKER_ALLOW_LEGACY_SIGNATURE:
            raise errors.ApiProblem(403, "forbidden", "Missing timestamp.")
        expected = worker_signature(secret, request.body)
    else:
        if not timestamp.isascii() or not timestamp.isdigit() or len(timestamp) > 12:
            raise errors.ApiProblem(403, "forbidden", "Bad timestamp.")
        if abs(time.time() - int(timestamp)) > settings.WORKER_SIGNATURE_MAX_SKEW_S:
            raise errors.ApiProblem(403, "forbidden", "Stale timestamp.")
        expected = worker_signature(secret, request.body, timestamp)
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
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
