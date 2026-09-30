import hashlib
import hmac
import json
from pathlib import Path

from twister_worker.signing import SIGNATURE_HEADER, encode_body, sign, signed_request

VECTOR = json.loads((Path(__file__).parent / "hmac_vector.json").read_text(encoding="utf-8"))


def test_vector_signature():
    assert VECTOR["header"] == SIGNATURE_HEADER
    assert sign(VECTOR["secret"], VECTOR["body"].encode()) == VECTOR["signature"]


def test_vector_header_value():
    assert (
        signed_request(VECTOR["secret"], VECTOR["payload"])[1][SIGNATURE_HEADER]
        == VECTOR["header_value"]
    )


def test_vector_cases():
    for case in VECTOR["cases"]:
        assert sign(VECTOR["secret"], case["body"].encode()) == case["signature"], case["name"]


def test_vector_payload_encodes_to_the_pinned_body():
    assert encode_body(VECTOR["payload"]).decode() == VECTOR["body"]


def test_matches_the_api_algorithm():
    # api/twisters/security.py: hmac.new(secret.encode(), request.body, sha256).hexdigest()
    expected = hmac.new(b"k", b"{}", hashlib.sha256).hexdigest()
    assert sign("k", b"{}") == expected


def test_signed_request_signs_the_exact_bytes_sent():
    body, headers = signed_request("k", {"b": 1, "a": 2})
    assert body == b'{"a":2,"b":1}'
    assert headers[SIGNATURE_HEADER] == "sha256=" + sign("k", body)
    assert headers["Content-Type"] == "application/json"
