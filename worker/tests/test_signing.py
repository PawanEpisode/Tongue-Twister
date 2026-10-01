import hashlib
import hmac
import json
from pathlib import Path

from twister_worker.signing import (
    SIGNATURE_HEADER,
    TIMESTAMP_HEADER,
    encode_body,
    sign,
    sign_legacy,
    signed_request,
)

VECTOR = json.loads((Path(__file__).parent / "hmac_vector.json").read_text(encoding="utf-8"))
TS = VECTOR["timestamp"]


def test_vector_headers():
    assert VECTOR["header"] == SIGNATURE_HEADER
    assert VECTOR["timestamp_header"] == TIMESTAMP_HEADER


def test_vector_signature():
    assert sign(VECTOR["secret"], TS, VECTOR["body"].encode()) == VECTOR["signature"]


def test_vector_header_value_and_headers_sent():
    body, headers = signed_request(VECTOR["secret"], VECTOR["payload"], now=int(TS))
    assert body.decode() == VECTOR["body"]
    assert headers[SIGNATURE_HEADER] == VECTOR["header_value"]
    assert headers[TIMESTAMP_HEADER] == TS


def test_vector_cases():
    for case in VECTOR["cases"]:
        assert sign(VECTOR["secret"], TS, case["body"].encode()) == case["signature"], case["name"]


def test_legacy_vector_is_still_pinned():
    legacy = VECTOR["legacy"]
    assert sign_legacy(VECTOR["secret"], VECTOR["body"].encode()) == legacy["signature"]
    for case in legacy["cases"]:
        assert sign_legacy(VECTOR["secret"], case["body"].encode()) == case["signature"]


def test_vector_payload_encodes_to_the_pinned_body():
    assert encode_body(VECTOR["payload"]).decode() == VECTOR["body"]


def test_matches_the_api_algorithm():
    # api/twisters/security.py: HMAC-SHA256(secret, f"{ts}." + body)
    expected = hmac.new(b"k", b"1700000000.{}", hashlib.sha256).hexdigest()
    assert sign("k", 1700000000, b"{}") == expected


def test_timestamp_is_part_of_the_signed_message():
    assert sign("k", 1, b"{}") != sign("k", 2, b"{}")
    assert sign("k", 1, b"{}") != sign_legacy("k", b"{}")


def test_signed_request_signs_the_exact_bytes_sent():
    body, headers = signed_request("k", {"b": 1, "a": 2}, now=1700000000.9)
    assert body == b'{"a":2,"b":1}'
    assert headers[TIMESTAMP_HEADER] == "1700000000"
    assert headers[SIGNATURE_HEADER] == "sha256=" + sign("k", 1700000000, body)
    assert headers["Content-Type"] == "application/json"
