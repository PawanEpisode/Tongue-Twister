"""HMAC request signing. Mirrors `api/twisters/security.py`.

Current scheme: `X-Worker-Timestamp: <unix seconds>` and `X-Worker-Signature: sha256=<hex>` where the
hex is HMAC-SHA256(secret, f"{timestamp}.".encode() + raw body). The API rejects timestamps further
than `WORKER_SIGNATURE_MAX_SKEW_S` from its own clock, so every attempt (including each retry) must be
signed afresh. The legacy scheme (no timestamp, HMAC over the body alone) is kept as `sign_legacy` for
the pinned vector only; the worker no longer sends it. `tests/hmac_vector.json` pins both algorithms
for both sides."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

SIGNATURE_HEADER = "X-Worker-Signature"
TIMESTAMP_HEADER = "X-Worker-Timestamp"
SIGNATURE_PREFIX = "sha256="


def sign(secret: str, timestamp: int | str, body: bytes) -> str:
    """Timestamped signature (current scheme)."""
    return hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def sign_legacy(secret: str, body: bytes) -> str:
    """Pre-timestamp signature. Only for the pinned vector; the API still accepts it while
    `WORKER_ALLOW_LEGACY_SIGNATURE=1`."""
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def encode_body(payload: dict[str, Any]) -> bytes:
    """Canonical JSON bytes. The exact bytes signed are the exact bytes sent."""
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()


def signed_request(
    secret: str, payload: dict[str, Any], *, now: float | None = None
) -> tuple[bytes, dict[str, str]]:
    body = encode_body(payload)
    timestamp = int(time.time() if now is None else now)
    return body, {
        "Content-Type": "application/json",
        TIMESTAMP_HEADER: str(timestamp),
        SIGNATURE_HEADER: SIGNATURE_PREFIX + sign(secret, timestamp, body),
    }
