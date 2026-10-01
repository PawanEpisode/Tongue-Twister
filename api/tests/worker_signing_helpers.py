"""Build the headers the media/scoring worker sends (current timestamped scheme or the legacy one)."""

import time

from twisters.security import worker_signature


def signed_headers(
    secret: str, body: bytes, *, timestamp: int | None = None, legacy: bool = False
) -> dict[str, str]:
    """Django test-client `**extra` headers for a signed callback."""
    if legacy:
        return {"HTTP_X_WORKER_SIGNATURE": "sha256=" + worker_signature(secret, body)}
    ts = int(time.time()) if timestamp is None else timestamp
    return {
        "HTTP_X_WORKER_TIMESTAMP": str(ts),
        "HTTP_X_WORKER_SIGNATURE": "sha256=" + worker_signature(secret, body, ts),
    }
