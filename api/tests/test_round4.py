"""Round 4 hardening: CSP report endpoint, stored-twister cap, usage pruning, export byte guard."""

import datetime as dt
import json
import logging

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient
from rest_framework.throttling import SimpleRateThrottle

from twisters.generate import quota, service
from twisters.models import GenerationUsage, Twister, TwisterVisibility

from .generate_helpers import ScriptedGenerator, enable_generation, private_twister
from .progress_helpers import at, error_code, make_attempt, new_profile, twister

pytestmark = pytest.mark.django_db
API = "/api/v1"
CSP_URL = f"{API}/csp-report/"
LEGACY = "application/csp-report"
MODERN = "application/reports+json"


@pytest.fixture
def anon():
    return APIClient()


def send(anon, payload, content_type=LEGACY, **extra):
    body = payload if isinstance(payload, bytes | str) else json.dumps(payload)
    return anon.post(CSP_URL, body, content_type=content_type, **extra)


def lines(caplog):
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("csp.violation")]


# --- csp report --------------------------------------------------------------------------------------------


def test_legacy_report_logs_directive_and_host_only(anon, caplog):
    caplog.set_level(logging.WARNING)
    report = {
        "csp-report": {
            "document-uri": "https://app.example/secret-page?token=abc",
            "referrer": "https://evil.example/?q=1",
            "violated-directive": "script-src-elem",
            "effective-directive": "script-src-elem",
            "blocked-uri": "https://cdn.evil.example/path/x.js?token=SECRET",
            "script-sample": "alert('PII')",
        }
    }
    assert send(anon, report).status_code == 204
    assert lines(caplog) == [
        "csp.violation directive=script-src-elem blocked_host=cdn.evil.example"
    ]
    text = caplog.text
    assert "SECRET" not in text and "secret-page" not in text and "PII" not in text


def test_reporting_api_batch(anon, caplog):
    caplog.set_level(logging.WARNING)
    batch = [
        {
            "type": "csp-violation",
            "url": "https://x.example/a?b=1",
            "body": {
                "effectiveDirective": "img-src",
                "blockedURL": "https://img.example/p.png?u=1",
            },
        },
        {
            "type": "csp-violation",
            "body": {"effectiveDirective": "script-src", "blockedURL": "inline"},
        },
        {"type": "deprecation", "body": {"id": "x"}},
        "junk",
    ]
    assert send(anon, batch, MODERN).status_code == 204
    assert lines(caplog) == [
        "csp.violation directive=img-src blocked_host=img.example",
        "csp.violation directive=script-src blocked_host=inline",
    ]


@pytest.mark.parametrize(
    "payload",
    [
        b"",
        b"not json",
        b"[1,2",
        b"null",
        b'{"csp-report": 5}',
        b'{"csp-report": {"blocked-uri": 7}}',
    ],
)
def test_garbage_is_still_204(anon, payload):
    assert send(anon, payload).status_code == 204


def test_hostile_directive_and_uri_values_are_neutralised(anon, caplog):
    caplog.set_level(logging.WARNING)
    report = {
        "csp-report": {"effective-directive": "script-src;FAKE=1", "blocked-uri": "http://[bad"}
    }
    assert send(anon, report).status_code == 204
    assert lines(caplog) == ["csp.violation directive=unknown blocked_host=other"]


def test_wrong_content_type_is_ignored_but_204(anon, caplog):
    caplog.set_level(logging.WARNING)
    r = send(anon, {"csp-report": {"effective-directive": "img-src"}}, "text/plain")
    assert r.status_code == 204 and lines(caplog) == []


def test_body_over_16kb_is_dropped_unread(anon, caplog):
    caplog.set_level(logging.WARNING)
    big = {
        "csp-report": {
            "effective-directive": "img-src",
            "blocked-uri": "https://a.example/" + "x" * 17000,
        }
    }
    assert send(anon, big).status_code == 204
    assert lines(caplog) == []


def test_needs_no_auth_and_is_throttled_per_ip(anon, monkeypatch):
    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "csp_report", "2/h")
    assert send(anon, b"{}").status_code == 204
    assert send(anon, b"{}").status_code == 204
    assert send(anon, b"{}").status_code == 429
    assert send(anon, b"{}", HTTP_X_FORWARDED_FOR="9.9.9.9").status_code in (204, 429)


def test_only_post_is_allowed(anon):
    assert anon.get(CSP_URL).status_code == 405


def test_the_csp_header_points_at_the_endpoint(client):
    response = client.get("/api/health/")
    policy = response["Content-Security-Policy-Report-Only"]
    assert policy.endswith("report-uri /api/v1/csp-report/; report-to csp-endpoint")
    assert response["Reporting-Endpoints"] == 'csp-endpoint="/api/v1/csp-report/"'


def test_a_policy_that_names_its_own_report_uri_is_not_doubled(client, settings):
    settings.API_CSP_REPORT_ONLY = "default-src 'none'; report-uri https://r.example/x"
    policy = client.get("/api/health/")["Content-Security-Policy-Report-Only"]
    assert policy.count("report-uri") == 1 and policy.endswith("report-to csp-endpoint")


# --- stored cap --------------------------------------------------------------------------------------------


@pytest.fixture
def gen(monkeypatch):
    enable_generation()
    scripted = ScriptedGenerator()
    monkeypatch.setattr(service, "get_generator", lambda: scripted)
    return scripted


def test_the_stored_cap_is_409_and_costs_nothing(user, gen, settings):
    settings.GENERATE_MAX_STORED = 2
    client, profile = user
    for _ in range(2):
        private_twister(profile)
    r = client.post(f"{API}/generate/", {"topic": "sea snakes"}, format="json")
    assert r.status_code == 409 and error_code(r) == "stored_limit"
    assert r.data["error"]["details"] == {"limit": 2, "stored": 2}
    assert gen.calls == [] and not GenerationUsage.objects.filter(profile=profile).exists()


def test_deleting_one_makes_room(user, gen, settings):
    settings.GENERATE_MAX_STORED = 1
    client, profile = user
    mine = private_twister(profile)
    assert (
        client.post(f"{API}/generate/", {"topic": "sea snakes"}, format="json").status_code == 409
    )
    assert client.delete(f"{API}/me/twisters/{mine.pk}/").status_code == 204
    assert (
        client.post(f"{API}/generate/", {"topic": "sea snakes"}, format="json").status_code == 201
    )


def test_quota_payload_includes_stored(user, gen, settings):
    settings.GENERATE_MAX_STORED = 3
    client, profile = user
    private_twister(profile)
    listed = client.get(f"{API}/me/twisters/").data["quota"]
    assert listed["stored"] == {"limit": 3, "used": 1, "remaining": 2}
    created = client.post(f"{API}/generate/", {"topic": "sea snakes"}, format="json")
    assert created.data["quota"]["stored"] == {"limit": 3, "used": 2, "remaining": 1}


def test_the_stored_cap_counts_only_my_private_twisters(user, auth_client, gen, settings):
    settings.GENERATE_MAX_STORED = 1
    client, _ = user
    other = new_profile()
    private_twister(other)
    assert Twister.objects.filter(visibility=TwisterVisibility.PUBLIC).exists()
    assert (
        client.post(f"{API}/generate/", {"topic": "sea snakes"}, format="json").status_code == 201
    )


def test_default_stored_cap_is_50(settings):
    assert settings.GENERATE_MAX_STORED == 50 and settings.GENERATE_USAGE_RETENTION_DAYS == 90


# --- prune -------------------------------------------------------------------------------------------------


def test_prune_deletes_only_rows_older_than_90_days(capsys):
    p = new_profile()
    now = dt.datetime(2026, 10, 1, 12, tzinfo=dt.UTC)
    for days_ago in (0, 89, 90, 91, 400):
        GenerationUsage.objects.create(
            profile=p, day=now.date() - dt.timedelta(days=days_ago), count=1
        )
    assert quota.prune(now) == 2
    kept = sorted((now.date() - u.day).days for u in GenerationUsage.objects.all())
    assert kept == [0, 89, 90]


def test_prune_command_runs_and_reports(capsys):
    p = new_profile()
    GenerationUsage.objects.create(profile=p, day=dt.date(2000, 1, 1), count=1)
    call_command("prune_generation_usage")
    assert "pruned=1" in capsys.readouterr().out
    call_command("prune_generation_usage")
    assert "pruned=0" in capsys.readouterr().out


def test_prune_is_in_the_workflow_allow_list_and_cron():
    from pathlib import Path

    text = (
        Path(__file__).resolve().parents[2] / ".github/workflows/manage-command.yml"
    ).read_text()
    assert "prune_generation_usage" in text.split("ALLOWED=")[1].split("\n")[0]
    assert 'cron: "19 5 * * *"' in text and "prune_generation_usage ;;" in text


# --- export byte guard -------------------------------------------------------------------------------------


def fetch(client):
    response = client.get(f"{API}/me/export/")
    assert response.status_code == 200
    raw = b"".join(response.streaming_content)
    return json.loads(raw), raw


def test_export_is_trimmed_to_the_byte_budget_newest_first(user, settings):
    client, profile = user
    for day in range(1, 11):
        make_attempt(profile, twister(), when=at(2026, 9, day), score=day)
    full, raw_full = fetch(client)
    assert full["truncated"] is False and len(full["attempts"]) == 10
    settings.EXPORT_MAX_BYTES = len(raw_full) - 600
    body, raw = fetch(client)
    assert body["truncated"] is True
    assert 0 < len(body["attempts"]) < 10
    assert len(raw) <= settings.EXPORT_MAX_BYTES
    scores = [a["score"] for a in body["attempts"]]
    assert scores == sorted(scores, reverse=True) and scores[0] == 10  # newest kept


def test_a_tiny_budget_still_gives_valid_json_with_the_other_sections(user, settings):
    client, profile = user
    make_attempt(profile, twister(), when=at(2026, 9, 1))
    settings.EXPORT_MAX_BYTES = 1
    body, _ = fetch(client)
    assert body["attempts"] == [] and body["truncated"] is True
    assert body["profile"]["id"] == str(profile.pk)


def test_default_byte_budget_is_below_vercels_limit(settings):
    assert settings.EXPORT_MAX_BYTES == 4_000_000 < 4_500_000
    assert settings.EXPORT_MAX_ATTEMPTS == 20000
