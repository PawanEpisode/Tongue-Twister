"""Sentry scrubbing and start-up (spec 15 §2.2). The scrubber is pure, so it is tested as a table."""

import os
import subprocess
import sys
from pathlib import Path

import pytest

from twisters import observability
from twisters.errors import ApiProblem

API_DIR = Path(__file__).resolve().parent.parent


def event(**request):
    return {"request": {"url": "https://api.test/api/v1/x/", "headers": {}, **request}}


def scrubbed(**request):
    return observability.scrub_event(event(**request))["request"]


# -- strings ---------------------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("/api/v1/public/r/AbC123_-xyz", "/api/v1/public/r/<token>"),
        ("/api/v1/public/s/AbC123/image.png", "/api/v1/public/s/<token>/image.png"),
        ("GET /public/unsubscribe/tok123?x=1 failed", "GET /public/unsubscribe/<token>?x=1 failed"),
        ("/api/v1/public/s/", "/api/v1/public/s/"),
        ("/api/v1/twisters/peter-piper/", "/api/v1/twisters/peter-piper/"),
        ("u?token=abc&page=2", "u?token=[Filtered]&page=2"),
        ("u?page=2&signature=deadbeef", "u?page=2&signature=[Filtered]"),
        (
            "u?X-Amz-Signature=abc&X-Amz-Credential=c&ok=1",
            "u?X-Amz-Signature=[Filtered]&X-Amz-Credential=[Filtered]&ok=1",
        ),
        ("u?search=tongue", "u?search=tongue"),
        ("Authorization: Bearer eyJhbGci.eyJzdWIi.sig", "Authorization: Bearer [Filtered]"),
        ("failed for jane.doe+x@example.co.uk now", "failed for [email] now"),
        ("two a@b.io and c@d.com", "two [email] and [email]"),
        ("plain message", "plain message"),
    ],
)
def test_scrub_string_table(raw, clean):
    assert observability.scrub_string(raw) == clean


# -- request ---------------------------------------------------------------------------------------
def test_sensitive_headers_removed_and_others_kept():
    headers = {
        "Authorization": "Bearer abc",
        "authorization": "Bearer abc",
        "Cookie": "sessionid=1",
        "X-Worker-Signature": "sha256=aa",
        "X-Worker-Timestamp": "1",
        "X-Forwarded-For": "1.2.3.4",
        "User-Agent": "pytest",
        "X-Request-Id": "req-1",
    }
    out = scrubbed(headers=headers)["headers"]
    assert out == {"User-Agent": "pytest", "X-Request-Id": "req-1"}


def test_list_style_headers():
    out = scrubbed(headers=[["Authorization", "x"], ["Accept", "json"]])["headers"]
    assert out == [["Accept", "json"]]


def test_cookies_dropped():
    assert "cookies" not in scrubbed(cookies={"sessionid": "1"})


@pytest.mark.parametrize(
    ("path", "kept"),
    [
        ("/api/v1/attempts/", False),
        ("/api/v1/attempts/abc/words/", False),
        ("/api/v1/internal/media/claim/", False),
        ("/api/v1/internal/scoring-jobs/1/result/", False),
        ("/api/v1/sessions/", True),
        ("/api/v1/twisters/attempts-of-doom/", True),
    ],
)
def test_bodies_only_dropped_where_they_hold_transcripts(path, kept):
    out = scrubbed(url=f"https://api.test{path}?a=1", data={"transcript": "she sells"})
    assert ("data" in out) is kept


def test_query_string_forms():
    assert scrubbed(query_string="token=abc&page=1")["query_string"] == "token=[Filtered]&page=1"
    assert scrubbed(query_string={"token": "abc", "page": "1"})["query_string"] == {
        "token": "[Filtered]",
        "page": "1",
    }
    assert scrubbed(query_string=[["signature", "s"], ["page", "1"]])["query_string"] == [
        ["signature", "[Filtered]"],
        ["page", "1"],
    ]


def test_url_tokens_removed():
    out = scrubbed(url="https://api.test/api/v1/public/r/SECRET?token=SECRET2")
    assert "SECRET" not in out["url"]
    assert out["url"] == "https://api.test/api/v1/public/r/<token>?token=[Filtered]"


def test_remote_addr_dropped():
    assert "REMOTE_ADDR" not in scrubbed(env={"REMOTE_ADDR": "9.9.9.9", "SERVER_NAME": "x"})["env"]


def test_request_id_header_becomes_a_tag():
    out = observability.scrub_event(event(headers={"X-Request-Id": "req-42"}))
    assert out["tags"]["request_id"] == "req-42"


# -- whole event -----------------------------------------------------------------------------------
def test_user_reduced_to_the_supabase_id():
    out = observability.scrub_event(
        {"user": {"id": "uuid-1", "email": "a@b.co", "ip_address": "1.1.1.1", "username": "jane"}}
    )
    assert out["user"] == {"id": "uuid-1"}
    assert observability.scrub_event({"user": {"email": "a@b.co"}})["user"] == {}


def test_emails_scrubbed_everywhere():
    out = observability.scrub_event(
        {
            "message": "bounce for a@b.co",
            "exception": {"values": [{"type": "E", "value": "no mailbox c@d.org"}]},
            "breadcrumbs": {
                "values": [{"message": "to e@f.net", "data": {"url": "/public/s/T0K"}}]
            },
            "extra": {"nested": [{"who": "g@h.io"}]},
        }
    )
    flat = repr(out)
    assert "@" not in flat and "T0K" not in flat
    assert out["message"] == "bounce for [email]"


def test_breadcrumb_hook_scrubs():
    crumb = observability.scrub_breadcrumb({"message": "x@y.com", "data": {"url": "/public/r/ZZ"}})
    assert crumb == {"message": "[email]", "data": {"url": "/public/r/<token>"}}


def test_expected_client_errors_are_dropped_and_crashes_kept():
    def hint(exc):
        return {"exc_info": (type(exc), exc, None)}

    assert observability.scrub_event({}, hint(ApiProblem(404, "not_found", "x"))) is None
    assert observability.scrub_event({}, hint(ApiProblem(429, "rate_limited", "x"))) is None
    assert observability.scrub_event({}, hint(ApiProblem(503, "dependency", "x"))) == {}
    assert observability.scrub_event({}, hint(ValueError("boom"))) == {}


def test_scrubber_fails_closed(caplog):
    class Boom(dict):
        def get(self, *_):
            raise RuntimeError

    assert observability.scrub_event(Boom()) is None


# -- start-up --------------------------------------------------------------------------------------
class Capture:
    """Stands in for the SDK transport: records envelopes instead of sending anything."""

    def __new__(cls):
        from sentry_sdk.transport import Transport

        class _Capture(Transport):
            def __init__(self):
                super().__init__()
                self.events = []

            def capture_envelope(self, envelope):
                for item in envelope.items:
                    if item.get_event() is not None:
                        self.events.append(item.get_event())

        return _Capture()


@pytest.fixture
def sentry_reset():
    import sentry_sdk

    yield
    sentry_sdk.get_global_scope().set_client(None)
    observability._enabled = False


def test_init_is_a_noop_without_a_dsn():
    assert observability.init_sentry("", environment="x") is False
    assert observability._enabled is False


def test_no_dsn_means_the_sdk_is_never_imported():
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DJANGO_", "SENTRY_"))}
    code = (
        "import sys, config.settings as s;"
        "assert not s.SENTRY_DSN; assert 'sentry_sdk' not in sys.modules, 'sdk imported'"
    )
    run = subprocess.run(
        [sys.executable, "-c", code],
        cwd=API_DIR,
        env={**env, "DJANGO_DEBUG": "1", "DATABASE_URL": ""},
        capture_output=True,
        text=True,
    )
    assert run.returncode == 0, run.stderr


def test_dsn_starts_the_sdk_from_settings():
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DJANGO_", "SENTRY_"))}
    code = (
        "import sentry_sdk, config.settings as s;"
        "c = sentry_sdk.get_client();"
        "assert c.is_active();"
        "o = c.options;"
        "assert o['send_default_pii'] is False and o['traces_sample_rate'] == 0.25;"
        "assert o['environment'] == 'staging' and o['release'] == 'abc123'"
    )
    run = subprocess.run(
        [sys.executable, "-c", code],
        cwd=API_DIR,
        env={
            **env,
            "DJANGO_DEBUG": "1",
            "DATABASE_URL": "",
            "SENTRY_DSN": "https://k@o1.ingest.invalid/1",
            "SENTRY_TRACES_SAMPLE_RATE": "0.25",
            "SENTRY_ENVIRONMENT": "staging",
            "VERCEL_GIT_COMMIT_SHA": "abc123",
        },
        capture_output=True,
        text=True,
    )
    assert run.returncode == 0, run.stderr


def test_default_environment_follows_debug():
    def environment(debug):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("DJANGO_", "SENTRY_"))}
        run = subprocess.run(
            [sys.executable, "-c", "import config.settings as s;print(s.SENTRY_ENVIRONMENT)"],
            cwd=API_DIR,
            env={
                **env,
                "DJANGO_DEBUG": debug,
                "DJANGO_SECRET_KEY": "k" * 20,
                "MEDIA_PATH_SECRET": "m",
                "DATABASE_URL": "",
            },
            capture_output=True,
            text=True,
        )
        return run.stdout.strip()

    assert environment("1") == "development"
    assert environment("0") == "production"


def test_init_with_stub_transport_scrubs_and_sends_nothing_real(sentry_reset):
    import sentry_sdk

    captured = Capture()
    started = observability.init_sentry(
        "https://k@o1.ingest.invalid/1",
        environment="test",
        release="r1",
        transport=captured,
    )
    assert started is True
    sentry_sdk.set_user({"id": "u1", "email": "me@example.com"})
    sentry_sdk.capture_message("failed for me@example.com at /public/s/SECRETTOKEN")
    sentry_sdk.flush()
    assert len(captured.events) == 1
    payload = repr(captured.events)
    assert "me@example.com" not in payload and "SECRETTOKEN" not in payload
    assert "[email]" in payload and "'id': 'u1'" in payload


def test_expected_error_is_not_reported(sentry_reset):
    import sentry_sdk

    captured = Capture()
    observability.init_sentry(
        "https://k@o1.ingest.invalid/1", environment="test", transport=captured
    )
    try:
        raise ApiProblem(404, "not_found", "nope")
    except ApiProblem:
        sentry_sdk.capture_exception()
    try:
        raise RuntimeError("real crash")
    except RuntimeError:
        sentry_sdk.capture_exception()
    sentry_sdk.flush()
    assert len(captured.events) == 1
    assert "real crash" in repr(captured.events)


def test_request_id_tag_helper(sentry_reset):
    import sentry_sdk

    observability.tag_request_id("ignored")  # disabled: no-op, must not raise
    captured = Capture()
    observability.init_sentry(
        "https://k@o1.ingest.invalid/1", environment="test", transport=captured
    )
    observability.tag_request_id("req-9")
    sentry_sdk.capture_message("hello")
    sentry_sdk.flush()
    assert captured.events[0]["tags"]["request_id"] == "req-9"
