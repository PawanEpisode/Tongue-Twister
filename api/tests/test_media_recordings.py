"""Cloud recordings: create, upload verification, quota ledger, read, update, delete/restore, IDOR."""

import datetime as dt
import re
import uuid

import pytest
from django.utils import timezone

from twisters.errors import ApiProblem
from twisters.media.uploads import owner_folder
from twisters.models import (
    Attempt,
    MediaAsset,
    MediaStatus,
    Plan,
    Recording,
    RecordingStatus,
    StorageLedger,
)

from .media_helpers import (
    API,
    JPEG,
    MB,
    MP4,
    WEBM,
    complete_recording,
    create_recording,
    error_code,
    ledger_total,
    put_upload,
    recording_body,
    saved_recording,
    sha256,
)
from .speak_helpers import SLUG, submit


def set_limits(**limits):
    plan = Plan.objects.get(code="free")
    plan.limits = {**plan.limits, **limits}
    plan.save()


# --- create -------------------------------------------------------------------------------------


def test_create_reserves_quota_and_returns_a_signed_upload(cloud_user):
    client, profile = cloud_user
    r = create_recording(client, size_bytes=9_215_032)
    assert r.status_code == 201
    rec, upload = r.data["recording"], r.data["upload"]
    assert rec["status"] == "uploading" and rec["twister"] == SLUG and rec["title"] == "My take"
    assert upload["provider"] == "memory" and upload["bucket"] == "recordings"
    assert re.fullmatch(
        rf"{owner_folder(profile.pk)}/\d{{4}}/\d{{2}}/[0-9a-f-]{{36}}\.webm", upload["path"]
    )
    assert upload["expires_in"] == 3600 and upload["chunk_size"] == 6 * MB
    assert set(upload) >= {"signed_url", "token", "standard_url"}
    assert r.data["quota"] == {
        "used_bytes": 9_215_032,
        "limit_bytes": 100 * MB,
        "count": 1,
        "count_limit": 5,
    }
    assert ledger_total(profile) == 9_215_032
    asset = MediaAsset.objects.get(profile=profile)
    assert asset.mime_type == "video/webm" and asset.status == MediaStatus.PENDING_UPLOAD


def test_create_is_idempotent_on_client_recording_id(cloud_user):
    client, profile = cloud_user
    body = recording_body()
    first = client.post(f"{API}/recordings/", body, format="json")
    again = client.post(f"{API}/recordings/", {**body, "title": "changed"}, format="json")
    assert first.status_code == 201 and again.status_code == 200
    assert again.headers["Idempotent-Replay"] == "true"
    assert again.data["recording"]["id"] == first.data["recording"]["id"]
    assert again.data["recording"]["title"] == "My take"
    assert again.data["upload"]["path"] == first.data["upload"]["path"]
    assert Recording.objects.filter(profile=profile).count() == 1
    assert StorageLedger.objects.filter(profile=profile).count() == 1


def test_idempotency_key_header_stands_in_for_the_body_field(cloud_user):
    client, _ = cloud_user
    body = recording_body()
    del body["client_recording_id"]
    key = str(uuid.uuid4())
    one = client.post(f"{API}/recordings/", body, format="json", HTTP_IDEMPOTENCY_KEY=key)
    two = client.post(f"{API}/recordings/", body, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert (one.status_code, two.status_code) == (201, 200)
    assert one.data["recording"]["client_recording_id"] == key


def test_create_with_a_replayed_id_after_delete_is_a_conflict(cloud_user, storage):
    client, _ = cloud_user
    body = recording_body()
    rid = client.post(f"{API}/recordings/", body, format="json").data["recording"]["id"]
    client.delete(f"{API}/recordings/{rid}/")
    r = client.post(f"{API}/recordings/", body, format="json")
    assert r.status_code == 409


@pytest.mark.parametrize(
    "over,status,code",
    [
        ({"mime_type": "video/x-msvideo"}, 415, "unsupported_media_type"),
        ({"mime_type": "audio/webm"}, 415, "unsupported_media_type"),
        ({"size_bytes": 100 * MB + 1}, 413, "too_large"),
        ({"duration_ms": 0}, 400, "validation_error"),
        ({"duration_ms": 600_001}, 400, "validation_error"),
        ({"twister": "ghost"}, 400, "validation_error"),
        ({"session_id": str(uuid.uuid4())}, 400, "validation_error"),
        ({"layout": "Not A Slug!"}, 400, "validation_error"),
        ({"layout_settings": {"k": "x" * 5000}}, 400, "validation_error"),
    ],
)
def test_create_validates_input(cloud_user, over, status, code):
    r = create_recording(cloud_user[0], **over)
    assert r.status_code == status and error_code(r) == code


def test_video_mp4_is_accepted_with_an_mp4_path(cloud_user):
    r = create_recording(cloud_user[0], mime_type="video/mp4;codecs=avc1")
    assert r.status_code == 201 and r.data["upload"]["path"].endswith(".mp4")


# --- quota --------------------------------------------------------------------------------------


def test_quota_by_bytes_names_the_limit(cloud_user):
    client, profile = cloud_user
    assert create_recording(client, size_bytes=60 * MB).status_code == 201
    r = create_recording(client, size_bytes=60 * MB)
    assert r.status_code == 402 and error_code(r) == "quota_exceeded"
    details = r.data["error"]["details"]
    assert details["limit"] == "storage_bytes" and details["limit_bytes"] == 100 * MB
    assert ledger_total(profile) == 60 * MB and Recording.objects.count() == 1


def test_quota_by_count_and_duration(cloud_user):
    client, _ = cloud_user
    r = create_recording(client, duration_ms=180_001)
    assert r.status_code == 402 and r.data["error"]["details"]["limit"] == "recording_ms"
    for _ in range(5):
        assert create_recording(client).status_code == 201
    r = create_recording(client)
    assert r.status_code == 402 and r.data["error"]["details"]["limit"] == "recordings"


def test_plan_limits_are_read_from_the_plan_row(cloud_user):
    client, _ = cloud_user
    set_limits(recordings_max=1)
    assert create_recording(client).status_code == 201
    assert create_recording(client).status_code == 402


def test_ledger_follows_reserve_complete_delete_and_hard_delete(cloud_user, storage):
    client, profile = cloud_user
    created = create_recording(client, size_bytes=5000)
    assert ledger_total(profile) == 5000
    put_upload(storage, created)
    rid = created.data["recording"]["id"]
    assert complete_recording(client, rid).status_code == 202
    assert ledger_total(profile) == len(WEBM)  # reconciled to the real size
    assert client.delete(f"{API}/recordings/{rid}/").status_code == 200
    assert ledger_total(profile) == len(WEBM)  # deferred until the hard delete
    assert client.get(f"{API}/me/storage/").data["count"] == 0

    from twisters.media import recordings

    Recording.objects.filter(pk=rid).update(deleted_at=timezone.now() - dt.timedelta(hours=25))
    assert recordings.hard_delete_due() == 1
    assert ledger_total(profile) == 0
    assert set(StorageLedger.objects.values_list("reason", flat=True)) == {
        "reserve",
        "complete",
        "delete",
    }


def test_reserve_refuses_what_does_not_fit_within_one_transaction(cloud_user):
    from django.db import transaction

    from twisters.media import quota

    _, profile = cloud_user
    with transaction.atomic():
        locked = quota.lock_profile(profile)
        first, second = (
            MediaAsset.objects.create(
                profile=locked, kind="video", bucket="recordings", path=p, mime_type="video/webm"
            )
            for p in ("a", "b")
        )
        quota.reserve(locked, first, "recording", 60 * MB)
        with pytest.raises(ApiProblem) as caught:
            quota.reserve(locked, second, "recording", 60 * MB)
    assert caught.value.code == "quota_exceeded"


def test_create_takes_the_profile_lock_before_reserving(cloud_user, monkeypatch):
    from twisters.media import quota

    calls: list[str] = []
    real_lock, real_reserve = quota.lock_profile, quota.reserve
    monkeypatch.setattr(quota, "lock_profile", lambda p: (calls.append("lock"), real_lock(p))[1])
    monkeypatch.setattr(
        quota, "reserve", lambda *a, **k: (calls.append("reserve"), real_reserve(*a, **k))[1]
    )
    assert create_recording(cloud_user[0]).status_code == 201
    assert calls == ["lock", "reserve"]


def test_lock_profile_refuses_to_run_outside_a_transaction(cloud_user):
    from unittest import mock

    from twisters.media import quota

    with mock.patch.object(quota.connection, "in_atomic_block", False):
        with pytest.raises(RuntimeError):
            quota.lock_profile(cloud_user[1])


@pytest.mark.django_db(transaction=True, serialized_rollback=True)
def test_parallel_creates_cannot_exceed_the_storage_limit(cloud_user):
    """Real concurrency: only meaningful on PostgreSQL (row locks); sqlite serialises writers anyway."""
    import threading

    from django.db import connection, connections

    if connection.vendor != "postgresql":
        pytest.skip("needs row-level locking")
    client, profile = cloud_user
    results: list[int] = []

    def worker():
        try:
            results.append(create_recording(client, size_bytes=60 * MB).status_code)
        finally:
            connections.close_all()

    threads = [threading.Thread(target=worker) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [201, 402, 402, 402]
    assert ledger_total(profile) == 60 * MB


# --- complete -----------------------------------------------------------------------------------


def test_complete_makes_the_recording_ready_and_playable(cloud_user, storage):
    client, profile = cloud_user
    created = create_recording(client, size_bytes=len(WEBM))
    put_upload(storage, created)
    rid = created.data["recording"]["id"]
    r = complete_recording(client, rid, size_bytes=len(WEBM), checksum_sha256=sha256(WEBM))
    assert r.status_code == 202
    assert r.data["status"] == "ready" and r.data["size_bytes"] == len(WEBM)
    playback = r.data["playback"]
    assert playback["mime"] == "video/webm" and playback["url"].startswith("memory://recordings/")
    rec = Recording.objects.get(pk=rid)
    assert rec.expires_at == rec.created_at + dt.timedelta(days=30)
    assert rec.video_asset.status == MediaStatus.READY and rec.consented_at is not None


def test_processing_flag_leaves_the_recording_processing(cloud_user, storage, settings):
    settings.MEDIA_PROCESSING_ENABLED = True
    r = saved_recording(cloud_user[0], storage)
    assert r["status"] == "processing" and r["playback"] is None


def test_complete_is_idempotent(cloud_user, storage):
    client, profile = cloud_user
    created = create_recording(client, size_bytes=len(WEBM))
    put_upload(storage, created)
    rid = created.data["recording"]["id"]
    assert complete_recording(client, rid).status_code == 202
    again = complete_recording(client, rid)
    assert again.status_code == 200 and again.headers["Idempotent-Replay"] == "true"
    assert again.data["status"] == "ready" and ledger_total(profile) == len(WEBM)


def test_complete_before_the_upload_finishes_is_retryable(cloud_user, storage):
    client, profile = cloud_user
    created = create_recording(client)
    rid = created.data["recording"]["id"]
    r = complete_recording(client, rid)
    assert r.status_code == 409 and error_code(r) == "upload_incomplete"
    assert Recording.objects.get(pk=rid).status == RecordingStatus.UPLOADING
    put_upload(storage, created)
    assert complete_recording(client, rid).status_code == 202


def test_complete_reconciles_a_wrong_declared_size(cloud_user, storage):
    client, profile = cloud_user
    created = create_recording(client, size_bytes=50 * MB)
    put_upload(storage, created)
    assert complete_recording(client, created.data["recording"]["id"]).status_code == 202
    assert ledger_total(profile) == len(WEBM)


def test_complete_fails_and_frees_bytes_when_the_real_size_does_not_fit(cloud_user, storage):
    client, profile = cloud_user
    set_limits(storage_bytes_max=1000)
    saved_recording(client, storage)
    created = create_recording(client, size_bytes=100)
    put_upload(storage, created, WEBM + bytes(900))
    rid = created.data["recording"]["id"]
    r = complete_recording(client, rid)
    assert r.status_code == 402 and error_code(r) == "quota_exceeded"
    rec = Recording.objects.get(pk=rid)
    assert rec.status == RecordingStatus.FAILED and rec.failure_reason == "quota_exceeded"
    assert ledger_total(profile) == len(WEBM)
    assert not storage.exists(created.data["upload"]["bucket"], created.data["upload"]["path"])


@pytest.mark.parametrize(
    "data,mime,checksum,reason",
    [
        (b"<html>not a video</html>" + bytes(40), "video/webm", None, "not_media"),
        (WEBM, "video/mp4", None, "not_media"),
        (MP4, "video/webm", None, "not_media"),
        (WEBM, "video/webm", "0" * 64, "checksum_mismatch"),
    ],
)
def test_content_sniffing_and_checksum_reject_and_clean_up(
    cloud_user, storage, data, mime, checksum, reason
):
    client, profile = cloud_user
    created = create_recording(client, mime_type=mime, size_bytes=len(data))
    put_upload(storage, created, data)
    upload, rid = created.data["upload"], created.data["recording"]["id"]
    r = complete_recording(client, rid, **({"checksum_sha256": checksum} if checksum else {}))
    assert r.status_code == 422 and error_code(r) == "upload_rejected"
    assert r.data["error"]["details"]["reason"] == reason
    assert Recording.objects.get(pk=rid).status == RecordingStatus.FAILED
    assert MediaAsset.objects.get(profile=profile).status == MediaStatus.FAILED
    assert ledger_total(profile) == 0 and not storage.exists(upload["bucket"], upload["path"])
    assert error_code(complete_recording(client, rid)) == "upload_rejected"  # stays rejected
    assert client.get(f"{API}/me/storage/").data["count"] == 0  # a failed take frees its slot


def test_a_correct_checksum_passes_and_a_malformed_one_is_a_400(cloud_user, storage):
    client, _ = cloud_user
    created = create_recording(client, size_bytes=len(WEBM))
    put_upload(storage, created)
    rid = created.data["recording"]["id"]
    assert complete_recording(client, rid, checksum_sha256="XYZ").status_code == 400
    assert complete_recording(client, rid, checksum_sha256=sha256(WEBM)).status_code == 202


def test_storage_outage_during_complete_is_503_and_changes_nothing(cloud_user, storage):
    client, profile = cloud_user
    created = create_recording(client, size_bytes=len(WEBM))
    put_upload(storage, created)
    rid = created.data["recording"]["id"]
    storage.fail_next = "stat"
    r = complete_recording(client, rid)
    assert r.status_code == 503 and error_code(r) == "dependency_unavailable"
    assert Recording.objects.get(pk=rid).status == RecordingStatus.UPLOADING
    assert complete_recording(client, rid).status_code == 202


def test_thumbnail_is_stored_charged_and_signed(cloud_user, storage):
    import base64

    client, profile = cloud_user
    created = create_recording(client, size_bytes=len(WEBM))
    put_upload(storage, created)
    uri = "data:image/jpeg;base64," + base64.b64encode(JPEG).decode()
    r = complete_recording(client, created.data["recording"]["id"], thumbnail=uri)
    assert r.status_code == 202 and r.data["thumbnail_url"].startswith("memory://thumbs/")
    assert ledger_total(profile) == len(WEBM) + len(JPEG)
    listed = client.get(f"{API}/recordings/").data["results"][0]
    assert listed["thumbnail_url"].startswith("memory://thumbs/")


@pytest.mark.parametrize(
    "thumbnail",
    ["not-a-data-uri", "data:image/jpeg;base64,@@@", "data:image/jpeg;base64,QUJD"],
)
def test_bad_thumbnails_are_rejected_before_anything_changes(cloud_user, storage, thumbnail):
    client, _ = cloud_user
    created = create_recording(client, size_bytes=len(WEBM))
    put_upload(storage, created)
    rid = created.data["recording"]["id"]
    assert complete_recording(client, rid, thumbnail=thumbnail).status_code == 400
    assert Recording.objects.get(pk=rid).status == RecordingStatus.UPLOADING


def test_oversized_thumbnail_is_rejected(cloud_user, storage):
    import base64

    client, _ = cloud_user
    created = create_recording(client, size_bytes=len(WEBM))
    put_upload(storage, created)
    big = base64.b64encode(b"\xff\xd8\xff" + bytes(201 * 1024)).decode()
    r = complete_recording(
        client, created.data["recording"]["id"], thumbnail=f"data:image/jpeg;base64,{big}"
    )
    assert r.status_code == 400


# --- read ---------------------------------------------------------------------------------------


def test_detail_has_attempt_words_playback_and_captions_shape(cloud_user, storage):
    client, profile = cloud_user
    attempt = submit(client, transcript="she shells seashells by the seashore").data
    rec = saved_recording(client, storage, attempt=attempt["id"])
    assert rec["attempt"]["id"] == attempt["id"] and rec["attempt"]["score"] == attempt["score"]
    assert rec["attempt_id"] == attempt["id"]
    assert {"target_index", "target", "spoken", "status", "start_ms", "end_ms"} <= set(
        rec["words"][0]
    )
    assert {"url", "expires_at", "mime"} == set(rec["playback"])
    assert rec["captions_url"] is None and rec["thumbnail_url"] is None
    assert rec["twister_text"].startswith("She sells")
    got = client.get(f"{API}/recordings/{rec['id']}/")
    assert got.status_code == 200 and got.data["id"] == rec["id"]
    assert got.headers.get("Cache-Control") is None or "public" not in got.headers["Cache-Control"]


def test_list_is_paginated_filtered_and_owner_only(cloud_user, storage, auth_client):
    client, _ = cloud_user
    saved_recording(client, storage)
    saved_recording(client, storage, twister="fuzzy-wuzzy")
    page = client.get(f"{API}/recordings/").data
    assert page["count"] == 2 and set(page) >= {"next", "previous", "results"}
    assert "playback" not in page["results"][0]
    only = client.get(f"{API}/recordings/?twister=fuzzy-wuzzy").data
    assert only["count"] == 1 and only["results"][0]["twister"] == "fuzzy-wuzzy"
    assert auth_client().get(f"{API}/recordings/").data["count"] == 0


def test_storage_endpoint_and_entitlements(cloud_user, storage):
    client, profile = cloud_user
    rec = saved_recording(client, storage)
    Recording.objects.filter(pk=rec["id"]).update(expires_at=timezone.now() + dt.timedelta(days=2))
    data = client.get(f"{API}/me/storage/").data
    assert data["used_bytes"] == len(WEBM) and data["limit_bytes"] == 100 * MB
    assert data["count"] == 1 and data["count_limit"] == 5
    assert [str(e["id"]) for e in data["expiring_soon"]] == [rec["id"]]
    assert set(data["expiring_soon"][0]) == {"id", "title", "expires_at"}
    ent = client.get(f"{API}/me/entitlements/").data
    assert ent["usage"] == {"used_bytes": len(WEBM), "count": 1}


# --- update -------------------------------------------------------------------------------------


def test_patch_updates_metadata(cloud_user, storage):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    url = f"{API}/recordings/{rec['id']}/"
    r = client.patch(
        url,
        {
            "title": "Better",
            "notes": "n",
            "visibility": "unlisted",
            "trim_start_ms": 500,
            "trim_end_ms": 9000,
            "crop_rect": {"x": 0, "y": 0, "w": 640, "h": 360},
            "layout_settings": {"corner": "br"},
        },
        format="json",
    )
    assert r.status_code == 200
    assert r.data["title"] == "Better" and r.data["visibility"] == "unlisted"
    assert r.data["trim_end_ms"] == 9000 and r.data["layout_settings"] == {"corner": "br"}
    assert client.put(url, {}, format="json").status_code == 405


@pytest.mark.parametrize(
    "body",
    [
        {"title": "x" * 81},
        {"visibility": "public"},
        {"trim_start_ms": 5000, "trim_end_ms": 5000},
        {"trim_end_ms": 999_999},
        {"trim_start_ms": 41_200},
        {"crop_rect": {"x": 0, "y": 0}},
        {"crop_rect": {"x": 0, "y": 0, "w": 0, "h": 10}},
        {"expires_at": "2001-01-01T00:00:00Z"},
        {"layout_settings": {"k": "x" * 5000}},
        {"notes": "x" * 1001},
    ],
)
def test_patch_rejects_bad_values(cloud_user, storage, body):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    r = client.patch(f"{API}/recordings/{rec['id']}/", body, format="json")
    assert r.status_code == 400 and error_code(r) == "validation_error"


def test_expires_at_is_capped_by_the_plan_and_never_in_the_past(cloud_user, storage):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    url = f"{API}/recordings/{rec['id']}/"
    soon = (timezone.now() + dt.timedelta(days=3)).isoformat()
    later = (timezone.now() + dt.timedelta(days=40)).isoformat()
    assert client.patch(url, {"expires_at": soon}, format="json").status_code == 200
    assert client.patch(url, {"expires_at": later}, format="json").status_code == 400


def test_attempt_linking_rules(cloud_user, storage, auth_client):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    url = f"{API}/recordings/{rec['id']}/"
    mine = submit(client).data["id"]
    other_twister = submit(client, twister="fuzzy-wuzzy").data["id"]
    theirs_client = auth_client()
    theirs = submit(theirs_client).data["id"]

    assert client.patch(url, {"attempt": other_twister}, format="json").status_code == 400
    assert client.patch(url, {"attempt": theirs}, format="json").status_code == 400
    assert client.patch(url, {"attempt": mine}, format="json").data["attempt"]["id"] == mine

    second = saved_recording(client, storage)
    r = client.patch(f"{API}/recordings/{second['id']}/", {"attempt": mine}, format="json")
    assert r.status_code == 409
    assert client.patch(url, {"attempt": None}, format="json").data["attempt"] is None


def test_a_record_attempt_can_be_created_and_linked(cloud_user, storage):
    client, _ = cloud_user
    attempt = submit(client, kind="record")
    assert attempt.status_code == 201 and attempt.data["kind"] == "record"
    assert attempt.data["words"], "record attempts keep their word-level results"
    rec = saved_recording(client, storage, attempt=attempt.data["id"])
    assert rec["attempt"]["kind"] == "record"
    assert str(Attempt.objects.get(pk=attempt.data["id"]).recording.pk) == rec["id"]


# --- delete / restore / retry -------------------------------------------------------------------


def test_soft_delete_hides_and_restore_brings_back(cloud_user, storage):
    client, profile = cloud_user
    rec = saved_recording(client, storage)
    url = f"{API}/recordings/{rec['id']}/"
    r = client.delete(url)
    assert r.status_code == 200 and str(r.data["id"]) == rec["id"] and r.data["restorable_until"]
    assert client.get(url).status_code == 404
    assert client.get(f"{API}/recordings/").data["count"] == 0
    assert client.delete(url).status_code == 404
    restored = client.post(f"{url}restore/")
    assert restored.status_code == 200 and restored.data["deleted_at"] is None
    assert client.get(url).status_code == 200
    assert client.post(f"{url}restore/").status_code == 404  # nothing to restore any more


def test_restore_after_the_window_is_gone(cloud_user, storage):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    client.delete(f"{API}/recordings/{rec['id']}/")
    Recording.objects.filter(pk=rec["id"]).update(
        deleted_at=timezone.now() - dt.timedelta(hours=25)
    )
    r = client.post(f"{API}/recordings/{rec['id']}/restore/")
    assert r.status_code == 410 and error_code(r) == "gone"


def test_restore_needs_a_free_slot_and_current_consent(cloud_user, storage):
    client, profile = cloud_user
    set_limits(recordings_max=1)
    rec = saved_recording(client, storage)
    client.delete(f"{API}/recordings/{rec['id']}/")
    saved_recording(client, storage)
    r = client.post(f"{API}/recordings/{rec['id']}/restore/")
    assert r.status_code == 402 and r.data["error"]["details"]["limit"] == "recordings"

    profile.consents.filter(type="recording_upload").update(revoked_at=timezone.now())
    assert error_code(client.post(f"{API}/recordings/{rec['id']}/restore/")) == "consent_required"


def test_retry_processing_only_when_failed(cloud_user, storage):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    url = f"{API}/recordings/{rec['id']}/retry-processing/"
    assert client.post(url).status_code == 409


# --- IDOR ---------------------------------------------------------------------------------------


def test_other_users_get_404_on_every_recording_route(cloud_user, storage, auth_client):
    client, _ = cloud_user
    rec = saved_recording(client, storage)
    stranger = auth_client()
    base = f"{API}/recordings/{rec['id']}/"
    assert stranger.get(base).status_code == 404
    assert stranger.patch(base, {"title": "x"}, format="json").status_code == 404
    assert stranger.delete(base).status_code == 404
    for action in ("complete", "restore", "retry-processing", "share"):
        assert stranger.post(f"{base}{action}/", {}, format="json").status_code == 404, action
    assert Recording.objects.get(pk=rec["id"]).title == "My take"


def test_unauthenticated_requests_are_refused(anon):
    assert anon.get(f"{API}/recordings/").status_code == 401
    assert anon.post(f"{API}/recordings/", {}, format="json").status_code == 401
    assert anon.get(f"{API}/me/storage/").status_code == 401


def test_creating_is_rate_limited(cloud_user, monkeypatch):
    from rest_framework.throttling import SimpleRateThrottle

    monkeypatch.setitem(SimpleRateThrottle.THROTTLE_RATES, "recordings", "2/h")
    client, _ = cloud_user
    codes = [create_recording(client).status_code for _ in range(3)]
    assert codes == [201, 201, 429]
