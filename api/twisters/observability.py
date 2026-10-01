"""Error reporting (Sentry) with PII scrubbing. Spec 15 §2.2.

`init_sentry` is called from `config/settings.py` only when `SENTRY_DSN` is set; without it nothing in
this module imports the SDK, opens a socket or costs start-up time. `scrub_event` is a pure function of
the event dict so it can be tested as a table; it is the last line of defence (the SDK is also started
with `send_default_pii=False`), and it fails closed: if scrubbing itself raises, the event is dropped.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping
from typing import Any

logger = logging.getLogger(__name__)

FILTERED = "[Filtered]"

# Headers that carry credentials, the worker's HMAC, or the caller's address.
_DROP_HEADERS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-forwarded-for",
    "x-real-ip",
    "proxy-authorization",
}
_DROP_HEADER_PREFIXES = ("x-worker-",)
# Request bodies on these paths hold transcripts, audio hashes and worker payloads.
_BODYLESS_PATH = re.compile(r"/(?:attempts|internal)(?:/|$)")
# Query parameters that carry a secret: our share/unsubscribe tokens and storage signed-URL parameters.
_SENSITIVE_QUERY_KEYS = re.compile(
    r"^(?:token|access_token|refresh_token|id_token|jwt|code|sig|signature|apikey|api_key|key|"
    r"x-amz-[a-z-]+|x-goog-[a-z-]+|se|sp|sv|sr|skoid)$",
    re.IGNORECASE,
)
_QUERY_PAIR = re.compile(r"([?&;])([^=&#;\s]+)=([^&#;\s]*)")
_TOKEN_PATH = re.compile(r"(/public/(?:r|s|unsubscribe)/)[^/?#\s\"']+")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}")
_BEARER = re.compile(r"(Bearer\s+)[A-Za-z0-9._~+/=-]+", re.IGNORECASE)
_SKIPPED_STATUS_FLOOR = 500  # ApiProblems below this are expected client errors, not crashes


def _redact_query_pair(match: re.Match[str]) -> str:
    sep, key, value = match.groups()
    return f"{sep}{key}={FILTERED if _SENSITIVE_QUERY_KEYS.match(key) else value}"


def scrub_string(text: str) -> str:
    """Remove tokens in paths, secret query parameters, bearer tokens and e-mail addresses."""
    text = _TOKEN_PATH.sub(r"\1<token>", text)
    if "?" in text or "&" in text:
        text = _QUERY_PAIR.sub(_redact_query_pair, text)
    text = _BEARER.sub(rf"\1{FILTERED}", text)
    return _EMAIL.sub("[email]", text)


def _walk(value: Any) -> Any:
    if isinstance(value, str):
        return scrub_string(value)
    if isinstance(value, Mapping):
        return {k: _walk(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_walk(v) for v in value]
    if isinstance(value, tuple):
        return tuple(_walk(v) for v in value)
    return value


def _scrub_headers(headers: Any) -> Any:
    def keep(name: str) -> bool:
        lowered = name.lower()
        return lowered not in _DROP_HEADERS and not lowered.startswith(_DROP_HEADER_PREFIXES)

    if isinstance(headers, Mapping):
        return {k: v for k, v in headers.items() if keep(str(k))}
    if isinstance(headers, list):  # [[name, value], ...]
        return [h for h in headers if not (len(h) == 2 and not keep(str(h[0])))]
    return headers


def _scrub_query_string(query: Any) -> Any:
    if isinstance(query, str):
        redacted = _QUERY_PAIR.sub(_redact_query_pair, "?" + query)
        return redacted[1:]
    if isinstance(query, Mapping):
        return {k: FILTERED if _SENSITIVE_QUERY_KEYS.match(str(k)) else v for k, v in query.items()}
    if isinstance(query, list):
        return [
            [p[0], FILTERED if _SENSITIVE_QUERY_KEYS.match(str(p[0])) else p[1]]
            if isinstance(p, list | tuple) and len(p) == 2
            else p
            for p in query
        ]
    return query


def _request_path(request: Mapping[str, Any]) -> str:
    url = str(request.get("url") or "")
    return re.sub(r"^[a-z]+://[^/]+", "", url).split("?", 1)[0]


def scrub_event(event: dict[str, Any], hint: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """`before_send` / `before_send_transaction`: drop expected client errors, then scrub the event.

    Returns None (drop) for an `ApiProblem` below 500 and when scrubbing fails (fail closed)."""
    try:
        exc = (hint or {}).get("exc_info")
        if exc and _is_expected_client_error(exc[1]):
            return None

        request = event.get("request")
        request_id = None
        if isinstance(request, dict):
            for name, value in _header_items(request.get("headers")):
                if name.lower() == "x-request-id":
                    request_id = value
            path = _request_path(request)
            request["headers"] = _scrub_headers(request.get("headers", {}))
            request.pop("cookies", None)
            if _BODYLESS_PATH.search(path):
                request.pop("data", None)
            if "query_string" in request:
                request["query_string"] = _scrub_query_string(request["query_string"])
            if isinstance(request.get("env"), dict):
                request["env"].pop("REMOTE_ADDR", None)

        user = event.get("user")
        if isinstance(user, Mapping):
            event["user"] = {"id": user["id"]} if user.get("id") else {}

        event = _walk(event)
        if request_id:
            event.setdefault("tags", {})
            if isinstance(event["tags"], dict):
                event["tags"]["request_id"] = request_id
        return event
    except Exception:  # noqa: BLE001 - a scrubber bug must never leak, so drop the event
        logger.warning("sentry scrub failed; event dropped")
        return None


def _header_items(headers: Any):
    if isinstance(headers, Mapping):
        yield from ((str(k), str(v)) for k, v in headers.items())
    elif isinstance(headers, list):
        yield from ((str(h[0]), str(h[1])) for h in headers if len(h) == 2)


def _is_expected_client_error(exc: BaseException) -> bool:
    from .errors import ApiProblem

    return isinstance(exc, ApiProblem) and exc.status_code < _SKIPPED_STATUS_FLOOR


def scrub_breadcrumb(crumb: dict[str, Any], hint: dict[str, Any] | None = None):
    return _walk(crumb)


_enabled = False


def tag_request_id(request_id: str) -> None:
    """Attach the request id to the current scope. A no-op (no SDK import) unless Sentry is on."""
    if not _enabled:
        return
    import sentry_sdk

    sentry_sdk.set_tag("request_id", request_id)


def init_sentry(
    dsn: str,
    *,
    environment: str,
    release: str | None = None,
    traces_sample_rate: float = 0.0,
    transport: Any = None,
) -> bool:
    """Start Sentry. Returns False and does nothing when `dsn` is blank. `transport` lets tests
    capture envelopes instead of sending them."""
    global _enabled
    if not dsn:
        return False
    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=dsn,
        integrations=[DjangoIntegration()],
        send_default_pii=False,
        traces_sample_rate=traces_sample_rate,
        release=release or None,
        environment=environment,
        before_send=scrub_event,
        before_send_transaction=scrub_event,
        before_breadcrumb=scrub_breadcrumb,
        max_request_body_size="never",
        transport=transport,
    )
    _enabled = True
    return True
