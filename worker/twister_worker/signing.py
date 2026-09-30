"""HMAC request signing. Mirrors `api/twisters/security.py`: hex HMAC-SHA256 of the raw request
body keyed with the shared secret, sent in `X-Worker-Signature` as `sha256=<hex>`. `tests/hmac_vector.json` pins the
algorithm for both sides."""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any

SIGNATURE_HEADER = "X-Worker-Signature"
SIGNATURE_PREFIX = "sha256="


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def encode_body(payload: dict[str, Any]) -> bytes:
    """Canonical JSON bytes. The exact bytes signed are the exact bytes sent."""
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()


def signed_request(secret: str, payload: dict[str, Any]) -> tuple[bytes, dict[str, str]]:
    body = encode_body(payload)
    return body, {
        "Content-Type": "application/json",
        SIGNATURE_HEADER: SIGNATURE_PREFIX + sign(secret, body),
    }
