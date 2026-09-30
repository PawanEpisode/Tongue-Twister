"""The media worker signs with the same scheme as `twisters.security`; both read one shared vector."""

import hashlib
import hmac
import json
from pathlib import Path

import pytest
from django.test import override_settings
from rest_framework.test import APIRequestFactory

from twisters.security import SIGNATURE_HEADER, require_worker_signature

VECTOR = json.loads(
    (Path(__file__).resolve().parents[2] / "worker/tests/hmac_vector.json").read_text("utf-8")
)
CASES = [
    {"name": "main", "body": VECTOR["body"], "signature": VECTOR["signature"]},
    *VECTOR["cases"],
]


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["name"])
def test_vector_matches_api_verifier(case):
    body = case["body"].encode()
    expected = hmac.new(VECTOR["secret"].encode(), body, hashlib.sha256).hexdigest()
    assert expected == case["signature"]
    request = APIRequestFactory().post(
        "/x/",
        data=body,
        content_type="application/json",
        **{"HTTP_X_WORKER_SIGNATURE": f"sha256={expected}"},
    )
    from rest_framework.request import Request

    with override_settings(WORKER_SHARED_SECRET=VECTOR["secret"]):
        require_worker_signature(Request(request))  # must not raise
    assert SIGNATURE_HEADER == VECTOR["header"]
