import re
import uuid

from django.conf import settings
from django.urls import reverse

from . import observability

_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


class RequestIdMiddleware:
    """Attach a request id (client-supplied if well-formed) to the request and echo it as X-Request-Id."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        supplied = request.headers.get("X-Request-Id", "")
        request.request_id = supplied if _SAFE_ID.match(supplied) else uuid.uuid4().hex
        observability.tag_request_id(request.request_id)
        response = self.get_response(request)
        response["X-Request-Id"] = request.request_id
        return response


REPORT_GROUP = "csp-endpoint"


def report_path() -> str:
    return reverse("csp-report")


def with_reporting(policy: str) -> str:
    """`policy` plus the report directives, unless the configured policy already names its own."""
    extra = [
        f"{name} {value}"
        for name, value in (("report-uri", report_path()), ("report-to", REPORT_GROUP))
        if name not in policy
    ]
    return "; ".join([policy.rstrip("; "), *extra])


class ApiResponseHeadersMiddleware:
    """Default response headers for the JSON API (spec 15 §2.3).

    * `Cache-Control: private, no-store` on authenticated requests and everything under `/internal/`,
      unless the view already chose a Cache-Control (the explicit public caches stay untouched).
    * `Content-Security-Policy-Report-Only` (`API_CSP_REPORT_ONLY`, blank disables) on JSON responses
      only, so the admin and other HTML are not affected. A JSON API needs no script, frame or
      subresource, so `default-src 'none'` is accurate; report-only until the reports (collected by
      `POST /csp-report/`, see `twisters.csp_report`) show nothing unexpected. `report-uri` and
      `report-to` (with its `Reporting-Endpoints` header) are appended to the configured policy.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if not response.has_header("Cache-Control") and (
            "Authorization" in request.headers or "/internal/" in request.path
        ):
            response["Cache-Control"] = "private, no-store"
        policy = settings.API_CSP_REPORT_ONLY
        if (
            policy
            and response.get("Content-Type", "").startswith("application/json")
            and not response.has_header("Content-Security-Policy-Report-Only")
        ):
            response["Content-Security-Policy-Report-Only"] = with_reporting(policy)
            response["Reporting-Endpoints"] = f'{REPORT_GROUP}="{report_path()}"'
        return response
