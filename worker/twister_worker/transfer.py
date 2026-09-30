"""Bounded, streamed transfers. Downloads abort as soon as the byte cap is crossed; uploads refuse
oversized files before sending. Both retry transient failures with backoff."""

from __future__ import annotations

import threading
from collections.abc import Iterator
from pathlib import Path

import httpx

from .errors import Cancelled, JobFailed, TransientError
from .models import OutputTarget
from .retry import call_with_retry

CHUNK = 1024 * 1024
_RETRYABLE = (TransientError, httpx.TransportError)


def download(
    http: httpx.Client,
    url: str,
    dest: Path,
    *,
    max_bytes: int,
    timeout_s: float,
    attempts: int,
    cancel: threading.Event,
) -> int:
    """Stream `url` to `dest`. Returns bytes written. Each attempt restarts from zero."""

    def once() -> int:
        total = 0
        with http.stream("GET", url, timeout=timeout_s) as response:
            status = response.status_code
            if status == 429 or status >= 500:
                raise TransientError(f"HTTP {status}")
            if status != 200:
                raise JobFailed("source_download_failed", f"source returned HTTP {status}")
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > max_bytes:
                raise JobFailed("source_too_large", "source exceeds the size cap")
            with dest.open("wb") as out:
                for chunk in response.iter_bytes(CHUNK):
                    if cancel.is_set():
                        raise Cancelled("cancelled")
                    total += len(chunk)
                    if total > max_bytes:
                        raise JobFailed("source_too_large", "source exceeds the size cap")
                    out.write(chunk)
        return total

    try:
        return call_with_retry(once, attempts=attempts, retry_on=_RETRYABLE, cancel=cancel)
    except _RETRYABLE as exc:
        raise JobFailed("source_download_failed", type(exc).__name__) from exc


def upload(
    http: httpx.Client,
    target: OutputTarget,
    src: Path,
    *,
    max_bytes: int,
    timeout_s: float,
    attempts: int,
    cancel: threading.Event,
) -> int:
    """PUT `src` to the signed upload URL . Returns bytes sent."""
    size = src.stat().st_size
    if size == 0:
        raise JobFailed("output_empty", "output file is empty")
    if size > max_bytes:
        raise JobFailed("output_too_large", "output exceeds the size cap")
    # The signed upload_url already carries its token (and allows upsert), so reruns overwrite.
    headers = {"Content-Type": target.mime, "Content-Length": str(size)}

    def body() -> Iterator[bytes]:
        with src.open("rb") as handle:
            while chunk := handle.read(CHUNK):
                yield chunk

    def once() -> int:
        response = http.put(target.upload_url, content=body(), headers=headers, timeout=timeout_s)
        status = response.status_code
        if status == 429 or status >= 500:
            raise TransientError(f"HTTP {status}")
        if status >= 300:
            raise JobFailed("upload_failed", f"storage returned HTTP {status}")
        return size

    try:
        return call_with_retry(once, attempts=attempts, retry_on=_RETRYABLE, cancel=cancel)
    except _RETRYABLE as exc:
        raise JobFailed("upload_failed", type(exc).__name__) from exc
