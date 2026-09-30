"""Scoped throttles whose windows are not a single unit, e.g. "30/10min" (API contract 07 §1)."""

import re

from rest_framework.throttling import ScopedRateThrottle, SimpleRateThrottle, UserRateThrottle

from .security import client_ip

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


class RecordingCreateThrottle(WindowedRateMixin, UserRateThrottle):
    """10 cloud recordings per hour per user (API contract 07 §1): uploads are the expensive path."""

    scope = "recordings"


class VoiceUploadThrottle(WindowedRateMixin, UserRateThrottle):
    scope = "voice_uploads"


class ShareCreateThrottle(WindowedRateMixin, UserRateThrottle):
    scope = "share_create"


class IpRateThrottle(WindowedRateMixin, SimpleRateThrottle):
    """Per client IP, for unauthenticated endpoints. Uses `client_ip` (proxy aware), not REMOTE_ADDR,
    because on Vercel every request would otherwise share the platform's address."""

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": client_ip(request)}


class ShareResolveThrottle(IpRateThrottle):
    """60 resolves per minute per IP: makes guessing 128-bit tokens (and scraping) pointless."""

    scope = "share_resolve"


class ShareReportThrottle(IpRateThrottle):
    scope = "share_report"


__all__ = [
    "AttemptSyncThrottle",
    "AttemptThrottle",
    "RecordingCreateThrottle",
    "ScopedRateThrottle",
    "ShareCreateThrottle",
    "ShareReportThrottle",
    "ShareResolveThrottle",
    "VoiceUploadThrottle",
    "WordFeedbackThrottle",
]
