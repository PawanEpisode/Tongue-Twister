"""Scoped throttles whose windows are not a single unit, e.g. "30/10min" (API contract 07 §1)."""

import re

from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle

_RATE = re.compile(r"^(\d+)/(\d+)(s|min|h|d)$")
_UNIT_SECONDS = {"s": 1, "min": 60, "h": 3600, "d": 86400}


class WindowedRateMixin:
    def parse_rate(self, rate):
        if rate is None:
            return (None, None)
        match = _RATE.match(rate)
        if not match:
            return super().parse_rate(rate)
        count, size, unit = match.groups()
        return int(count), int(size) * _UNIT_SECONDS[unit]


class AttemptThrottle(WindowedRateMixin, UserRateThrottle):
    """30 scored attempts per 10 minutes per user (anti-cheat, PRD 03 S13)."""

    scope = "attempts"


class AttemptSyncThrottle(WindowedRateMixin, UserRateThrottle):
    scope = "attempts_sync"


class WordFeedbackThrottle(WindowedRateMixin, UserRateThrottle):
    scope = "word_feedback"


__all__ = ["AttemptSyncThrottle", "AttemptThrottle", "ScopedRateThrottle", "WordFeedbackThrottle"]
