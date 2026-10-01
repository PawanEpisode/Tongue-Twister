"""The media worker signs with the same scheme as `twisters.security`; both read one shared vector."""

import hashlib
import hmac
import json
from pathlib import Path

import pytest
from django.test import override_settings
from rest_framework.request import Request
from rest_framework.test import APIRequestFactory

from twisters.security import (
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    require_worker_signature,
    worker_signature,
)

VECTOR = json.loads(
    (Path(__file__).resolve().parents[2] / "worker/tests/hmac_vector.json").read_text("utf-8")
)
TS = VECTOR["timestamp"]
CASES = [
    {"name": "main", "body": VECTOR["body"], "signature": VECTOR["signature"]},
    *VECTOR["cases"],
]
LEGACY_CASES = [
    {"name": "main", "body": VECTOR["body"], "signature": VECTOR["legacy"]["signature"]},
    *VECTOR["legacy"]["cases"],
]


def verify(body: bytes, headers: dict[str, str], **overrides) -> None:
    request = APIRequestFactory().post("/x/", data=body, content_type="application/json", **headers)
    with override_settings(WORKER_SHARED_SECRET=VECTOR["secret"], **overrides):
        require_worker_signature(Request(request))


def test_header_names_match_the_vector():
    assert SIGNATURE_HEADER == VECTOR["header"]
    assert TIMESTAMP_HEADER == VECTOR["timestamp_header"]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_vector_matches_api_verifier(case, monkeypatch):
    body = case["body"].encode()
    expected = hmac.new(VECTOR["secret"].encode(), f"{TS}.".encode() + body, hashlib.sha256)
    assert expected.hexdigest() == case["signature"] == worker_signature(VECTOR["secret"], body, TS)
    # Freeze the API clock at the vector's timestamp so the pinned signature verifies as sent.
    monkeypatch.setattr("twisters.security.time.time", lambda: float(TS))
    verify(
        body,
        {"HTTP_X_WORKER_TIMESTAMP": TS, "HTTP_X_WORKER_SIGNATURE": f"sha256={case['signature']}"},
    )


@pytest.mark.parametrize("case", LEGACY_CASES, ids=lambda c: c["name"])
def test_legacy_vector_matches_api_verifier(case):
    body = case["body"].encode()
    expected = hmac.new(VECTOR["secret"].encode(), body, hashlib.sha256).hexdigest()
    assert expected == case["signature"] == worker_signature(VECTOR["secret"], body)
    verify(
        body, {"HTTP_X_WORKER_SIGNATURE": f"sha256={expected}"}, WORKER_ALLOW_LEGACY_SIGNATURE=True
    )
