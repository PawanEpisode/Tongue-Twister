"""Retry with exponential backoff and jitter. Sleep and randomness are injectable for tests."""

from __future__ import annotations

import random
import threading
import time
from collections.abc import Callable

from .errors import Cancelled


def backoff_delay(attempt: int, *, base_s: float, max_s: float, jitter: float) -> float:
    """Delay before retry number `attempt` (0-based): base * 2^attempt, capped, scaled into
    [0.5, 1.0] of itself by `jitter` (a 0..1 random draw)."""
    raw = min(max_s, base_s * (2**attempt))
    return raw * (0.5 + 0.5 * jitter)


def call_with_retry[T](
    fn: Callable[[], T],
    *,
    attempts: int,
    retry_on: tuple[type[BaseException], ...],
    base_s: float = 1.0,
    max_s: float = 30.0,
    cancel: threading.Event | None = None,
    sleep: Callable[[float], None] = time.sleep,
    rand: Callable[[], float] = random.random,
) -> T:
    """Call `fn`, retrying on `retry_on` up to `attempts` total tries. The last error propagates."""
    for attempt in range(attempts):
        if cancel is not None and cancel.is_set():
            raise Cancelled("cancelled")
        try:
            return fn()
        except retry_on:
            if attempt == attempts - 1:
                raise
            sleep(backoff_delay(attempt, base_s=base_s, max_s=max_s, jitter=rand()))
    raise AssertionError("attempts must be >= 1")  # pragma: no cover
