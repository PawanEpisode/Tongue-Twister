"""Voice clips: opt-in cloud copies of Speak & score audio, attachable to attempts."""

import datetime as dt

import pytest
from django.utils import timezone

from twisters.models import Attempt, FeatureFlag, MediaAsset, MediaStatus

from .media_helpers import API, MB, WEBM, error_code, ledger_total, put_upload
from .speak_helpers import submit

VOICE = {"mime_type": "audio/webm;codecs=opus", "size_bytes": len(WEBM), "duration_ms": 4000}


def create_voice(client, **over):
    return client.post(f"{API}/voice/", {**VOICE, **over}, format="json")


def complete_voice(client, asset_id, **body):
    return client.post(f"{API}/voice/{asset_id}/complete/", body, format="json")


def ready_voice(client, storage):
    created = create_voice(client)
    put_upload(storage, created)
    assert complete_voice(client, created.data["voice_asset_id"]).status_code == 202
    return created.data["voice_asset_id"]


def test_create_reserves_bytes_and_expires_in_thirty_days(cloud_user):
    client, profile = cloud_user
    r = create_voice(client)
    assert r.status_code == 201
    assert set(r.data) == {"voice_asset_id", "status", "expires_at", "upload", "quota"}
    assert r.data["upload"]["bucket"] == "voice" and r.data["upload"]["path"].endswith(".webm")
    asset = MediaAsset.objects.get(pk=r.data["voice_asset_id"])
    assert abs(asset.expires_at - timezone.now() - dt.timedelta(days=30)) < dt.timedelta(minutes=1)
    assert ledger_total(profile) == len(WEBM)


def test_voice_needs_the_cloud_flag_age_and_voice_consent(user):
    client, profile = user
    assert error_code(create_voice(client)) == "feature_disabled"
    FeatureFlag.objects.filter(code="record_cloud").update(enabled=True)
    assert error_code(create_voice(client)) == "age_required"
    type(profile).objects.filter(pk=profile.pk).update(age_band="13plus")
    assert error_code(create_voice(client)) == "consent_required"


@pytest.mark.parametrize(
    "over,status,code",
    [
        ({"duration_ms": 60_001}, 413, "too_large"),
        ({"size_bytes": 2 * MB + 1}, 413, "too_large"),
        ({"mime_type": "video/webm"}, 415, "unsupported_media_type"),
        ({"mime_type": "audio/mpeg"}, 415, "unsupported_media_type"),
        ({"size_bytes": 0}, 400, "validation_error"),
    ],
)
def test_voice_limits_come_from_the_plan(cloud_user, over, status, code):
    r = create_voice(cloud_user[0], **over)
    assert r.status_code == status and error_code(r) == code


def test_complete_makes_the_clip_ready_and_is_idempotent(cloud_user, storage):
    client, profile = cloud_user
    created = create_voice(client)
    aid = created.data["voice_asset_id"]
    assert error_code(complete_voice(client, aid)) == "upload_incomplete"
    put_upload(storage, created)
    first = complete_voice(client, aid)
    assert first.status_code == 202 and first.data["status"] == "ready"
    again = complete_voice(client, aid)
    assert again.status_code == 200 and again.headers["Idempotent-Replay"] == "true"
    assert ledger_total(profile) == len(WEBM)


def test_a_non_audio_upload_is_rejected(cloud_user, storage):
    client, profile = cloud_user
    created = create_voice(client)
    put_upload(storage, created, b"not audio at all, just text")
    r = complete_voice(client, created.data["voice_asset_id"])
    assert r.status_code == 422 and r.data["error"]["details"]["reason"] == "not_media"
    assert ledger_total(profile) == 0
    assert MediaAsset.objects.get().status == MediaStatus.FAILED


def test_only_the_owner_can_complete_and_only_audio_assets(cloud_user, storage, auth_client):
    client, _ = cloud_user
    created = create_voice(client)
    aid = created.data["voice_asset_id"]
    assert complete_voice(auth_client(), aid).status_code == 404
    video = MediaAsset.objects.create(
        profile=cloud_user[1], kind="video", bucket="recordings", path="p", mime_type="video/webm"
    )
    assert complete_voice(client, video.pk).status_code == 404


def test_a_ready_clip_can_be_attached_to_an_attempt(cloud_user, storage):
    client, _ = cloud_user
    aid = ready_voice(client, storage)
    r = submit(client, voice_asset_id=aid)
    assert r.status_code == 201
    assert str(Attempt.objects.get(pk=r.data["id"]).voice_asset_id) == str(aid)


def test_foreign_missing_or_unfinished_clips_cannot_be_attached(cloud_user, auth_client, storage):
    import uuid

    client, _ = cloud_user
    unfinished = create_voice(client).data["voice_asset_id"]
    strangers_client = auth_client()
    FeatureFlag.objects.filter(code="record_cloud").update(enabled=True)
    for bad in (unfinished, str(uuid.uuid4())):
        r = submit(client, voice_asset_id=bad)
        assert r.status_code == 400 and "voice_asset_id" in r.data["error"]["details"]
    theirs = ready_voice(client, storage)
    assert submit(strangers_client, voice_asset_id=theirs).status_code == 400


def test_voice_creation_is_rate_limited(cloud_user, monkeypatch):
    from rest_framework.throttling import SimpleRateThrottle

    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "voice_uploads", "1/h")
    assert create_voice(cloud_user[0]).status_code == 201
    assert create_voice(cloud_user[0]).status_code == 429
