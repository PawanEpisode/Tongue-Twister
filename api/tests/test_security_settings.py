"""Production-safe security settings (spec 15 §2.3) and the default API response headers."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parent.parent
PROBE = (
    "import json, config.settings as s;"
    "print(json.dumps({k: getattr(s, k, None) for k in ("
    "'SECURE_CONTENT_TYPE_NOSNIFF','SECURE_REFERRER_POLICY','X_FRAME_OPTIONS','SECURE_HSTS_SECONDS',"
    "'SECURE_HSTS_INCLUDE_SUBDOMAINS','SECURE_HSTS_PRELOAD','SECURE_PROXY_SSL_HEADER',"
    "'SESSION_COOKIE_SECURE','CSRF_COOKIE_SECURE','SESSION_COOKIE_HTTPONLY','SESSION_COOKIE_SAMESITE',"
    "'CSRF_COOKIE_SAMESITE','CORS_ALLOW_CREDENTIALS','API_CSP_REPORT_ONLY')}))"
)


def read_settings(debug: str, **env) -> dict:
    base = {
        k: v for k, v in os.environ.items() if not k.startswith(("DJANGO_", "MEDIA_", "SECURE_"))
    }
    run = subprocess.run(
        [sys.executable, "-c", PROBE],
        cwd=API_DIR,
        env={
            **base,
            "DATABASE_URL": "",
            "DJANGO_DEBUG": debug,
            "DJANGO_SECRET_KEY": "k" * 32,
            "MEDIA_PATH_SECRET": "m" * 16,
            **env,
        },
        capture_output=True,
        text=True,
    )
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout.strip().splitlines()[-1])


def test_production_defaults():
    s = read_settings("0")
    assert s["SECURE_CONTENT_TYPE_NOSNIFF"] is True
    assert s["SECURE_REFERRER_POLICY"] == "same-origin"
    assert s["X_FRAME_OPTIONS"] == "DENY"
    assert s["SECURE_HSTS_SECONDS"] == 31_536_000
    assert s["SECURE_HSTS_INCLUDE_SUBDOMAINS"] is True
    assert s["SECURE_HSTS_PRELOAD"] is False
    assert s["SECURE_PROXY_SSL_HEADER"] == ["HTTP_X_FORWARDED_PROTO", "https"]
    assert s["SESSION_COOKIE_SECURE"] and s["CSRF_COOKIE_SECURE"]
    assert s["SESSION_COOKIE_HTTPONLY"] is True
    assert s["SESSION_COOKIE_SAMESITE"] == "Lax" and s["CSRF_COOKIE_SAMESITE"] == "Lax"
    assert s["CORS_ALLOW_CREDENTIALS"] is False


def test_production_env_overrides():
    s = read_settings(
        "0",
        SECURE_HSTS_SECONDS="60",
        SECURE_HSTS_INCLUDE_SUBDOMAINS="0",
        SECURE_HSTS_PRELOAD="1",
        SECURE_REFERRER_POLICY="same-origin",
        API_CSP_REPORT_ONLY="",
    )
    assert s["SECURE_HSTS_SECONDS"] == 60
    assert s["SECURE_HSTS_INCLUDE_SUBDOMAINS"] is False and s["SECURE_HSTS_PRELOAD"] is True
    assert s["SECURE_REFERRER_POLICY"] == "same-origin"
    assert s["API_CSP_REPORT_ONLY"] == ""


def test_dev_does_not_pin_hsts_or_trust_the_proxy_header():
    s = read_settings("1")
    assert s["SECURE_HSTS_SECONDS"] is None  # Django default (0): no HSTS on http://localhost
    assert s["SECURE_PROXY_SSL_HEADER"] is None
    assert s["SESSION_COOKIE_SECURE"] is None
    assert s["X_FRAME_OPTIONS"] == "DENY"


def test_hsts_header_is_emitted_over_https_in_production(settings, client):
    settings.SECURE_HSTS_SECONDS = 31_536_000
    settings.SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    settings.SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    response = client.get("/api/health/", HTTP_X_FORWARDED_PROTO="https")
    assert response["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["Referrer-Policy"] == "same-origin"
    assert response["X-Frame-Options"] == "DENY"


# -- ApiResponseHeadersMiddleware ------------------------------------------------------------------
@pytest.mark.django_db
def test_json_responses_carry_the_report_only_csp(client):
    response = client.get("/api/health/")
    assert response["Content-Security-Policy-Report-Only"] == (
        "default-src 'none'; frame-ancestors 'none'"
    )
    assert "Content-Security-Policy" not in response  # report-only: never enforcing


@pytest.mark.django_db
def test_csp_can_be_switched_off_and_skips_html(client, settings):
    settings.API_CSP_REPORT_ONLY = ""
    assert "Content-Security-Policy-Report-Only" not in client.get("/api/health/")
    settings.API_CSP_REPORT_ONLY = "default-src 'none'"
    assert "Content-Security-Policy-Report-Only" not in client.get("/admin/login/")


@pytest.mark.django_db
def test_authenticated_and_internal_responses_are_not_cached(client):
    anonymous = client.get("/api/health/")
    assert not anonymous.has_header("Cache-Control")
    bearer = client.get("/api/health/", HTTP_AUTHORIZATION="Bearer not-checked-here")
    assert bearer["Cache-Control"] == "private, no-store"
    internal = client.post("/api/v1/internal/media/claim/", b"{}", content_type="application/json")
    assert internal["Cache-Control"] == "private, no-store"


@pytest.mark.django_db
def test_explicit_cache_headers_are_left_alone(client, rf):
    from django.http import JsonResponse

    from twisters.middleware import ApiResponseHeadersMiddleware

    def view(_request):
        response = JsonResponse({})
        response["Cache-Control"] = "public, max-age=3600"
        return response

    request = rf.get("/x/", HTTP_AUTHORIZATION="Bearer t")
    response = ApiResponseHeadersMiddleware(view)(request)
    assert response["Cache-Control"] == "public, max-age=3600"


@pytest.mark.django_db
def test_cors_allow_list_and_vary_origin_still_work(client, settings):
    settings.CORS_ALLOWED_ORIGINS = ["http://localhost:3000"]
    ok = client.get("/api/health/", HTTP_ORIGIN="http://localhost:3000")
    assert ok["Access-Control-Allow-Origin"] == "http://localhost:3000"
    assert "origin" in ok["Vary"].lower()
    bad = client.get("/api/health/", HTTP_ORIGIN="https://evil.example")
    assert "Access-Control-Allow-Origin" not in bad
