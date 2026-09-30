"""Shared builders for the media (06c) API tests."""

import hashlib
import hmac
import json
import uuid

from django.db.models import Sum

from twisters.models import StorageLedger

from .speak_helpers import SLUG

API = "/api/v1"
WEBM = b"\x1a\x45\xdf\xa3" + bytes(60)
MP4 = b"\x00\x00\x00\x18ftypmp42" + bytes(50)
JPEG = b"\xff\xd8\xff\xe0" + bytes(100)
WAV = b"RIFF\x24\x00\x00\x00WAVE" + bytes(60)
MB = 1024 * 1024
WORKER_SECRET = "worker-secret"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def recording_body(**over) -> dict:
    return {
        "client_recording_id": str(uuid.uuid4()),
        "twister": SLUG,
        "layout": "camera_text",
        "has_camera": True,
        "has_mic": True,
        "duration_ms": 41_200,
        "width": 1280,
        "height": 720,
        "fps": 30,
        "mime_type": "video/webm;codecs=vp9,opus",
        "size_bytes": len(WEBM),
        "title": "My take",
        **over,
    }


def create_recording(client, **over):
    return client.post(f"{API}/recordings/", recording_body(**over), format="json")


def put_upload(storage, response, data: bytes = WEBM) -> None:
    """Play the browser: put bytes where the signed upload said to."""
    upload = response.data["upload"]
    storage.simulate_upload(upload["bucket"], upload["path"], data)


def complete_recording(client, recording_id, **body):
    return client.post(f"{API}/recordings/{recording_id}/complete/", body, format="json")


def saved_recording(client, storage, *, data: bytes = WEBM, **over) -> dict:
    """Create → upload → complete; returns the detail payload of a `ready` recording."""
    created = create_recording(client, **{"size_bytes": len(data), **over})
    assert created.status_code == 201, created.data
    put_upload(storage, created, data)
    done = complete_recording(client, created.data["recording"]["id"])
    assert done.status_code == 202, done.data
    return done.data


def ledger_total(profile) -> int:
    return StorageLedger.objects.filter(profile=profile).aggregate(t=Sum("delta_bytes"))["t"] or 0


def error_code(response) -> str:
    return response.data["error"]["code"]


def signed_post(client, path: str, body=None, *, secret: str = WORKER_SECRET, sign=True, raw=None):
    """POST to an `/internal/` worker endpoint the way the worker does (HMAC of the raw body)."""
    payload = raw if raw is not None else json.dumps({} if body is None else body).encode()
    headers = {}
    if sign:
        digest = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
        headers["HTTP_X_WORKER_SIGNATURE"] = f"sha256={digest}"
    return client.post(f"{API}{path}", payload, content_type="application/json", **headers)
