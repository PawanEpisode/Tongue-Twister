"""Content-Security-Policy violation reports (`POST /csp-report/`, spec 19).

Browsers post these on their own, so the endpoint is public, throttled per IP and deliberately dull:
it always answers 204, whatever it was sent. What is logged is one line holding the violated directive
and the host of the blocked URI and nothing else: a blocked URL can carry a token in its path or query
string, and the report also names the page and may quote a script sample, so none of that is read.
Both wire formats are understood: the legacy `application/csp-report` (`report-uri`) and the Reporting
API `application/reports+json` (`report-to`).
"""

from __future__ import annotations

import json
import logging
import re
from urllib.parse import urlsplit

from django.conf import settings
from django.http import HttpRequest
from rest_framework import permissions, status
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
    throttle_classes,
)
from rest_framework.response import Response

from .throttles import CspReportThrottle

log = logging.getLogger(__name__)

ACCEPTED_TYPES = ("application/csp-report", "application/reports+json", "application/json")
_DIRECTIVE = re.compile(r"^[a-z][a-z-]{0,39}$")
# CSP keywords that stand in for a URL; anything else that is not a URL with a host becomes "other".
_KEYWORDS = frozenset(
    {"inline", "eval", "data", "blob", "self", "wasm-eval", "trusted-types-policy"}
)
MAX_PER_REQUEST = 10  # a Reporting API batch is a list


def _host(value) -> str:
    """The host of a blocked URI (never its path or query), a CSP keyword, or "other"."""
    if not isinstance(value, str) or not value:
        return "other"
    if value in _KEYWORDS:
        return value
    try:
        host = urlsplit(value).hostname
    except ValueError:
        return "other"
    return host[:100] if host else "other"


def _directive(value) -> str:
    """Only the directive *name*: `script-src-elem 'self'` becomes `script-src-elem`."""
    if not isinstance(value, str) or not value.strip():
        return "unknown"
    name = value.split()[0].lower()
    return name if _DIRECTIVE.match(name) else "unknown"


def _legacy(document: dict) -> list[tuple[str, str]]:
    body = document.get("csp-report")
    if not isinstance(body, dict):
        return []
    directive = body.get("effective-directive") or body.get("violated-directive")
    return [(_directive(directive), _host(body.get("blocked-uri")))]


def _reporting_api(document: list) -> list[tuple[str, str]]:
    found = []
    for item in document[:MAX_PER_REQUEST]:
        body = item.get("body") if isinstance(item, dict) else None
        if (
            isinstance(item, dict)
            and item.get("type") == "csp-violation"
            and isinstance(body, dict)
        ):
            found.append(
                (
                    _directive(body.get("effectiveDirective") or body.get("violatedDirective")),
                    _host(body.get("blockedURL") or body.get("blockedURI")),
                )
            )
    return found


def parse(raw: bytes) -> list[tuple[str, str]]:
    """`(directive, blocked host)` pairs from a report body; empty for anything unrecognisable."""
    try:
        document = json.loads(raw)
    except (ValueError, RecursionError):
        return []
    if isinstance(document, dict):
        return _legacy(document)
    return _reporting_api(document) if isinstance(document, list) else []


def read_body(request: HttpRequest) -> bytes:
    """The body, or nothing when it is over `CSP_REPORT_MAX_BYTES` (checked before reading it)."""
    limit = settings.CSP_REPORT_MAX_BYTES
    declared = request.META.get("CONTENT_LENGTH") or ""
    if not declared.isdigit() or int(declared) > limit:
        return b""  # chunked or oversized: not worth reading
    return request.body


def record(raw: bytes) -> int:
    reports = parse(raw)
    for directive, host in reports:
        log.warning("csp.violation directive=%s blocked_host=%s", directive, host)
    return len(reports)


@api_view(["POST"])
@authentication_classes([])
@permission_classes([permissions.AllowAny])
@throttle_classes([CspReportThrottle])
def csp_report(request):
    """Always 204: a browser does not retry or read the answer, and probes learn nothing."""
    content_type = request.content_type.split(";")[0].strip().lower()
    if content_type in ACCEPTED_TYPES:
        record(read_body(request._request))
    return Response(status=status.HTTP_204_NO_CONTENT)
