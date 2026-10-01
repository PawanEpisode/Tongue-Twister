"""Timestamped worker HMAC (spec 15 §2.1): valid, tampered, wrong secret, clock skew, legacy on/off."""

import json
import time

import pytest
from rest_framework.exceptions import APIException

from .media_helpers import WORKER_SECRET, signed_post
from .test_worker_signing_vector import verify
from .worker_signing_helpers import signed_headers

BODY = b'{"worker_id":"w1"}'
SECRET = "test-shared-secret"  # the vector's secret, which `verify` configures


def check(body=BODY, *, secret=SECRET, timestamp=None, legacy=False, **overrides):
    verify(body, signed_headers(secret, body, timestamp=timestamp, legacy=legacy), **overrides)


def rejected(**kwargs) -> int:
    with pytest.raises(APIException) as err:
        check(**kwargs)
    return err.value.status_code


def test_valid_signature_passes():
    check()


def test_tampered_body_is_rejected():
    headers = signed_headers(SECRET, BODY)
    with pytest.raises(APIException) as err:
        verify(b'{"worker_id":"w2"}', headers)
    assert err.value.status_code == 403


def test_wrong_secret_is_rejected():
    assert rejected(secret="not-the-secret") == 403


def test_signature_does_not_transfer_to_another_timestamp():
    now = int(time.time())
    headers = signed_headers(SECRET, BODY, timestamp=now)
    headers["HTTP_X_WORKER_TIMESTAMP"] = str(now + 1)
    with pytest.raises(APIException) as err:
        verify(BODY, headers)
    assert err.value.status_code == 403


def test_old_timestamp_is_rejected():
    assert rejected(timestamp=int(time.time()) - 301) == 403


def test_future_timestamp_is_rejected():
    assert rejected(timestamp=int(time.time()) + 301) == 403


def test_edges_of_the_window_pass():
    check(timestamp=int(time.time()) - 290)
    check(timestamp=int(time.time()) + 290)


def test_skew_window_is_a_setting():
    stale = int(time.time()) - 20
    assert rejected(timestamp=stale, WORKER_SIGNATURE_MAX_SKEW_S=10) == 403
    check(timestamp=stale, WORKER_SIGNATURE_MAX_SKEW_S=60)


@pytest.mark.parametrize("bad", ["", "abc", "-5", "12.5", "1e9", " 17", "９９９", "1" * 40])
def test_malformed_timestamp_is_rejected(bad):
    headers = signed_headers(SECRET, BODY)
    headers["HTTP_X_WORKER_TIMESTAMP"] = bad
    with pytest.raises(APIException) as err:
        verify(BODY, headers)
    assert err.value.status_code == 403


def test_legacy_signature_accepted_only_while_the_flag_is_on():
    check(legacy=True, WORKER_ALLOW_LEGACY_SIGNATURE=True)
    assert rejected(legacy=True, WORKER_ALLOW_LEGACY_SIGNATURE=False) == 403


def test_legacy_flag_defaults_on_and_skew_to_300(settings):
    assert settings.WORKER_ALLOW_LEGACY_SIGNATURE is True
    assert settings.WORKER_SIGNATURE_MAX_SKEW_S == 300


def test_timestamped_request_is_never_downgraded_to_legacy():
    # A body-only signature sent together with a timestamp header must fail even with legacy on.
    headers = signed_headers(SECRET, BODY, legacy=True)
    headers["HTTP_X_WORKER_TIMESTAMP"] = str(int(time.time()))
    with pytest.raises(APIException) as err:
        verify(BODY, headers, WORKER_ALLOW_LEGACY_SIGNATURE=True)
    assert err.value.status_code == 403


def test_missing_signature_is_rejected():
    with pytest.raises(APIException) as err:
        verify(BODY, {"HTTP_X_WORKER_TIMESTAMP": str(int(time.time()))})
    assert err.value.status_code == 403


def test_non_ascii_signature_header_is_a_403_not_a_crash():
    with pytest.raises(APIException) as err:
        verify(
            BODY, {"HTTP_X_WORKER_TIMESTAMP": str(int(time.time())), "HTTP_X_WORKER_SIGNATURE": "é"}
        )
    assert err.value.status_code == 403


def test_no_secret_configured_is_503(settings):
    from rest_framework.request import Request
    from rest_framework.test import APIRequestFactory

    from twisters.security import require_worker_signature

    settings.WORKER_SHARED_SECRET = ""
    with pytest.raises(APIException) as err:
        require_worker_signature(
            Request(APIRequestFactory().post("/x/", data=b"{}", content_type="application/json"))
        )
    assert err.value.status_code == 503


@pytest.mark.django_db
def test_endpoints_use_the_helper(client, settings):
    settings.WORKER_SHARED_SECRET = WORKER_SECRET
    assert signed_post(client, "/internal/media/claim/").status_code == 200
    assert signed_post(client, "/internal/media/claim/", sign=False).status_code == 403
    raw = json.dumps({}).encode()
    old = client.post(
        "/api/v1/internal/media/claim/",
        raw,
        content_type="application/json",
        **signed_headers(WORKER_SECRET, raw, timestamp=int(time.time()) - 3600),
    )
    assert old.status_code == 403
    legacy = client.post(
        "/api/v1/internal/media/claim/",
        raw,
        content_type="application/json",
        **signed_headers(WORKER_SECRET, raw, legacy=True),
    )
    assert legacy.status_code == 200
    settings.WORKER_ALLOW_LEGACY_SIGNATURE = False
    legacy = client.post(
        "/api/v1/internal/media/claim/",
        raw,
        content_type="application/json",
        **signed_headers(WORKER_SECRET, raw, legacy=True),
    )
    assert legacy.status_code == 403
