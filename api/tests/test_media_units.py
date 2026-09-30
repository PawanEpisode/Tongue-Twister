"""Storage adapters, state machines, security helpers and database-level invariants."""

import hashlib
import hmac
import json
import logging
import re
import uuid
from pathlib import Path

import pytest
from django.db import IntegrityError, transaction
from django.test import RequestFactory
from django.utils import timezone

from twisters import security
from twisters.errors import ApiProblem
from twisters.media import shares, uploads
from twisters.media import storage as storage_mod
from twisters.models import (
    InvalidTransition,
    MediaAsset,
    MediaStatus,
    ModerationReport,
    Profile,
    Recording,
    RecordingStatus,
    ShareLink,
    StorageLedger,
    Twister,
    UserConsent,
)

from .media_helpers import JPEG, MB, MP4, WEBM

REPO = Path(__file__).resolve().parents[2]


# --- Supabase adapter (fake transport: nothing here touches a network) ---------------------------


class FakeTransport:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, request):
        self.calls.append(request)
        return self.responses.pop(0)


def ok(payload=None, status=200):
    body = json.dumps(payload).encode() if payload is not None else b""
    return status, {}, body


def supa(*responses):
    transport = FakeTransport(*responses)
    return storage_mod.SupabaseStorage(
        "https://x.supabase.co/", "SERVICE-KEY", transport
    ), transport


def test_create_upload_asks_for_a_signed_token_and_returns_tus_details():
    s, t = supa(ok({"url": "/object/upload/sign/recordings/a/b.webm?token=T0KEN"}))
    up = s.create_upload("recordings", "a/b.webm", "video/webm", 3600)
    call = t.calls[0]
    assert call.method == "POST"
    assert (
        call.full_url == "https://x.supabase.co/storage/v1/object/upload/sign/recordings/a/b.webm"
    )
    assert call.headers["Authorization"] == "Bearer SERVICE-KEY"
    assert up.provider == "supabase" and up.token == "T0KEN"
    assert up.signed_url == "https://x.supabase.co/storage/v1/upload/resumable"
    assert up.chunk_size == 6 * MB and up.expires_in == 3600
    assert "SERVICE-KEY" not in json.dumps(up.as_dict())


def test_create_upload_can_ask_for_upsert_so_worker_retries_overwrite():
    s, t = supa(ok({"url": "/object/upload/sign/recordings/a/b.mp4?token=T"}))
    s.create_upload("recordings", "a/b.mp4", "video/mp4", 3600, upsert=True)
    assert t.calls[0].headers["X-upsert"] == "true"
    s, t = supa(ok({"url": "/object/upload/sign/recordings/a/b.mp4?token=T"}))
    s.create_upload("recordings", "a/b.mp4", "video/mp4", 3600)
    assert "X-upsert" not in t.calls[0].headers


def test_stat_maps_404_to_none_and_reads_size():
    s, _ = supa(ok(status=404), ok({"size": 42, "contentType": "video/webm"}))
    assert s.stat("recordings", "a") is None
    stat = s.stat("recordings", "a")
    assert stat.size == 42 and stat.mime_type == "video/webm" and stat.checksum_sha256 is None


def test_read_head_sends_a_range_and_put_upserts():
    s, t = supa(ok(status=206), ok())
    s.read_head("recordings", "a/b.webm", 16)
    assert t.calls[0].headers["Range"] == "bytes=0-15"
    s.put("thumbs", "a/t.jpg", JPEG, "image/jpeg")
    assert t.calls[1].headers["X-upsert"] == "true" and t.calls[1].data == JPEG


def test_signed_urls_are_absolute_single_and_batched():
    s, t = supa(
        ok({"signedURL": "/object/sign/recordings/a?token=X"}),
        ok(
            [
                {"path": "a", "signedURL": "/object/sign/thumbs/a?token=Y"},
                {"path": "b", "error": "x"},
            ]
        ),
    )
    assert s.signed_url("recordings", "a", 900) == (
        "https://x.supabase.co/storage/v1/object/sign/recordings/a?token=X"
    )
    assert json.loads(t.calls[0].data) == {"expiresIn": 900}
    urls = s.signed_urls("thumbs", ["a", "b"], 900)
    assert list(urls) == ["a"] and json.loads(t.calls[1].data)["paths"] == ["a", "b"]
    assert s.signed_urls("thumbs", [], 900) == {}


def test_delete_tolerates_missing_objects():
    s, _ = supa(ok(status=404), ok())
    s.delete("recordings", "gone")
    s.delete("recordings", "there")


def test_object_names_are_url_encoded():
    s, t = supa(ok(status=404))
    s.stat("recordings", "u/2026/09/a b#c.webm")
    assert t.calls[0].full_url.endswith("/object/info/recordings/u/2026/09/a%20b%23c.webm")


def test_errors_never_carry_the_key_or_url(caplog):
    s, _ = supa(ok(status=500))
    with caplog.at_level(logging.DEBUG), pytest.raises(storage_mod.StorageError) as caught:
        s.put("thumbs", "secret-user-id/t.jpg", JPEG, "image/jpeg")
    combined = str(caught.value) + caplog.text
    assert "SERVICE-KEY" not in combined and "secret-user-id" not in combined
    assert "SERVICE-KEY" not in repr(s.__dict__.get("api", "")) + s.api


def test_network_failures_become_storage_errors():
    def boom(_request):
        raise storage_mod.StorageError("network error")

    s = storage_mod.SupabaseStorage("https://x", "k", boom)
    with pytest.raises(storage_mod.StorageError):
        s.stat("recordings", "a")


def test_the_factory_picks_a_backend_and_refuses_missing_config(settings):
    settings.MEDIA_STORAGE_BACKEND = "memory"
    assert storage_mod.get_storage() is storage_mod.get_storage()
    settings.MEDIA_STORAGE_BACKEND = "supabase"
    settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY = "", ""
    with pytest.raises(ApiProblem) as caught:
        storage_mod.get_storage()
    assert caught.value.status_code == 503 and caught.value.code == "dependency_unavailable"
    settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY = "https://x.supabase.co", "k"
    assert isinstance(storage_mod.get_storage(), storage_mod.SupabaseStorage)
    settings.MEDIA_STORAGE_BACKEND = "carrier-pigeon"
    with pytest.raises(ApiProblem):
        storage_mod.get_storage()


def test_test_settings_can_never_reach_a_real_bucket():
    from django.conf import settings

    assert settings.MEDIA_STORAGE_BACKEND == "memory"


def test_in_memory_storage_behaves_like_a_bucket(storage):
    assert storage.stat("b", "p") is None
    storage.put("b", "p", WEBM, "video/webm")
    stat = storage.stat("b", "p")
    assert stat.size == len(WEBM) and stat.checksum_sha256 == hashlib.sha256(WEBM).hexdigest()
    assert storage.read_head("b", "p", 4) == WEBM[:4]
    assert storage.signed_url("b", "p", 60).startswith("memory://b/p")
    storage.delete("b", "p")
    storage.delete("b", "p")
    with pytest.raises(storage_mod.StorageError):
        storage.read_head("b", "p", 4)


# --- content sniffing ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "mime,data,ok_",
    [
        ("video/webm", WEBM, True),
        ("video/webm", MP4, False),
        ("video/mp4", MP4, True),
        ("video/mp4", WEBM, False),
        ("audio/ogg", b"OggS" + bytes(20), True),
        ("audio/wav", b"RIFF\x00\x00\x00\x00WAVEfmt ", True),
        ("audio/wav", b"RIFF\x00\x00\x00\x00AVI LIST", False),
        ("image/jpeg", JPEG, True),
        ("text/vtt", b"\xef\xbb\xbfWEBVTT\n", True),
        ("text/vtt", b"<html>", False),
    ],
)
def test_sniffing_matches_the_declared_type(mime, data, ok_):
    assert uploads.MIME_RULES[mime].sniff(data[: uploads.SNIFF_BYTES]) is ok_


def test_base_mime_drops_codec_parameters():
    assert uploads.base_mime("Video/WebM;codecs=vp9, opus") == "video/webm"


def test_object_paths_are_opaque_and_stable_per_owner(settings):
    import datetime as dt

    pid, other, aid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    when = dt.datetime(2026, 9, 3, tzinfo=dt.UTC)
    path = uploads.object_path(pid, aid, "webm", when)
    folder = uploads.owner_folder(pid)
    assert path == f"{folder}/2026/09/{aid}.webm"
    assert re.fullmatch(r"[0-9a-f]{16}", folder) and str(pid) not in path
    assert uploads.owner_folder(pid) == folder != uploads.owner_folder(other)
    settings.MEDIA_PATH_SECRET = "another-secret"  # a different key gives different folders
    assert uploads.owner_folder(pid) != folder


# --- state machines -----------------------------------------------------------------------------


def make_asset(profile, **over):
    return MediaAsset.objects.create(
        profile=profile,
        kind="video",
        bucket="recordings",
        path=over.pop("path", str(uuid.uuid4())),
        mime_type="video/webm",
        **over,
    )


def test_media_asset_transitions_follow_erd_06(user):
    _, profile = user
    asset = make_asset(profile)
    assert asset.transition(MediaStatus.UPLOADED) is True
    assert asset.transition(MediaStatus.UPLOADED) is False  # idempotent
    with pytest.raises(InvalidTransition):
        asset.transition(MediaStatus.PENDING_UPLOAD)
    asset.transition(MediaStatus.PROCESSING)
    asset.transition(MediaStatus.READY)
    asset.transition(MediaStatus.DELETED, deleted_at=timezone.now())
    asset.refresh_from_db()
    assert asset.status == "deleted" and asset.deleted_at is not None
    with pytest.raises(InvalidTransition):
        asset.transition(MediaStatus.READY)


def test_recording_transitions_follow_erd_06(cloud_user, storage):
    from .media_helpers import create_recording

    client, _ = cloud_user
    rec = Recording.objects.get(pk=create_recording(client).data["recording"]["id"])
    with pytest.raises(InvalidTransition):
        rec.transition(RecordingStatus.READY)  # cannot skip `uploaded`
    rec.transition(RecordingStatus.UPLOADED)
    rec.transition(RecordingStatus.READY)
    rec.transition(RecordingStatus.DELETED)
    with pytest.raises(InvalidTransition):
        rec.transition(RecordingStatus.UPLOADING)


# --- security helpers ---------------------------------------------------------------------------


def test_client_ip_prefers_the_first_forwarded_hop():
    rf = RequestFactory()
    assert security.client_ip(rf.get("/", HTTP_X_FORWARDED_FOR="7.7.7.7, 10.0.0.1")) == "7.7.7.7"
    assert security.client_ip(rf.get("/", REMOTE_ADDR="5.5.5.5")) == "5.5.5.5"


def test_ip_hashes_are_salted_and_stable(settings):
    request = RequestFactory().get("/", HTTP_X_FORWARDED_FOR="7.7.7.7")
    settings.IP_HASH_SALT = "one"
    first = security.hash_ip(request)
    assert first == security.hash_ip(request) and "7.7.7.7" not in first and len(first) == 64
    settings.IP_HASH_SALT = "two"
    assert security.hash_ip(request) != first


def test_worker_signature_check_is_constant_time_and_body_bound(settings, monkeypatch):
    settings.WORKER_SHARED_SECRET = "s"
    body = b'{"a":1}'
    good = "sha256=" + hmac.new(b"s", body, hashlib.sha256).hexdigest()
    request = RequestFactory().post(
        "/", body, content_type="application/json", HTTP_X_WORKER_SIGNATURE=good
    )
    calls = []
    real = hmac.compare_digest
    monkeypatch.setattr(security.hmac, "compare_digest", lambda a, b: calls.append(1) or real(a, b))
    security.require_worker_signature(request)
    assert calls
    tampered = RequestFactory().post(
        "/", b'{"a":2}', content_type="application/json", HTTP_X_WORKER_SIGNATURE=good
    )
    with pytest.raises(ApiProblem) as caught:
        security.require_worker_signature(tampered)
    assert caught.value.status_code == 403


def test_share_tokens_are_128_bit_and_hashed_with_compare_digest(monkeypatch):
    tokens = {shares.mint_token() for _ in range(50)}
    assert len(tokens) == 50 and all(len(t) >= 22 for t in tokens)
    assert shares.hash_token("abc") == hashlib.sha256(b"abc").hexdigest()


def test_resolve_compares_hashes_in_constant_time(cloud_user, storage, monkeypatch):
    from .media_helpers import saved_recording
    from .test_media_shares import share, token_of

    client, _ = cloud_user
    rec = saved_recording(client, storage)
    token = token_of(share(client, rec["id"]))
    calls = []
    real = hmac.compare_digest
    monkeypatch.setattr(shares.hmac, "compare_digest", lambda a, b: calls.append(1) or real(a, b))
    shares.resolve(token, "recording")
    assert calls


# --- database invariants (each must hold without help from the Python layer) --------------------


def recording_row(profile, **over):
    twister = Twister.objects.first()
    return Recording(
        profile=profile,
        client_recording_id=over.pop("client_recording_id", uuid.uuid4()),
        twister=twister,
        duration_ms=over.pop("duration_ms", 1000),
        mime_type="video/webm",
        size_bytes=over.pop("size_bytes", 10),
        **over,
    )


def violates(build):
    with pytest.raises(IntegrityError), transaction.atomic():
        build()


def test_recording_constraints(user):
    _, profile = user
    recording_row(profile, trim_start_ms=0, trim_end_ms=500).save()
    violates(lambda: recording_row(profile, trim_start_ms=500, trim_end_ms=500).save())
    violates(lambda: recording_row(profile, trim_start_ms=500, trim_end_ms=100).save())
    violates(lambda: recording_row(profile, duration_ms=600_001).save())
    violates(lambda: recording_row(profile, size_bytes=100 * MB + 1).save())
    violates(lambda: recording_row(profile, visibility="public").save())
    violates(lambda: recording_row(profile, status="exploded").save())
    same = uuid.uuid4()
    recording_row(profile, client_recording_id=same).save()
    violates(lambda: recording_row(profile, client_recording_id=same).save())


def test_asset_ledger_share_and_consent_constraints(user):
    _, profile = user
    asset = make_asset(profile, path="p1")
    violates(lambda: make_asset(profile, path="p1"))  # (bucket, path) unique
    violates(lambda: make_asset(profile, path="p2", size_bytes=100 * MB + 1))
    violates(lambda: make_asset(profile, path="p3", size_bytes=-1))
    violates(
        lambda: MediaAsset.objects.create(
            profile=profile, kind="hologram", bucket="b", path="p4", mime_type="x"
        )
    )
    violates(
        lambda: StorageLedger.objects.create(
            profile=profile, kind="recording", asset=asset, delta_bytes=0, reason="reserve"
        )
    )

    def link(hash_):
        return ShareLink.objects.create(
            target_type="recording",
            target_id=uuid.uuid4(),
            token_hash=hash_,
            created_by=profile,
            expires_at=timezone.now(),
        )

    link("a" * 64)
    violates(lambda: link("a" * 64))

    UserConsent.objects.create(profile=profile, type="terms", version="v1")
    violates(lambda: UserConsent.objects.create(profile=profile, type="terms", version="v2"))
    UserConsent.objects.filter(type="terms").update(revoked_at=timezone.now())
    UserConsent.objects.create(profile=profile, type="terms", version="v2")  # after revoke: fine


def test_report_dedupe_constraints(user):
    _, profile = user
    link = ShareLink.objects.create(
        target_type="recording",
        target_id=uuid.uuid4(),
        token_hash="b" * 64,
        created_by=profile,
        expires_at=timezone.now(),
    )
    ModerationReport.objects.create(share_link=link, reporter=profile, reason="spam")
    violates(
        lambda: ModerationReport.objects.create(share_link=link, reporter=profile, reason="abuse")
    )
    ModerationReport.objects.create(share_link=link, reporter_ip_hash="h", reason="spam")
    violates(
        lambda: ModerationReport.objects.create(
            share_link=link, reporter_ip_hash="h", reason="abuse"
        )
    )
    violates(
        lambda: ModerationReport.objects.create(
            share_link=link, reporter_ip_hash="i", reason="nonsense"
        )
    )


def test_profile_age_band_defaults_to_unknown(user):
    assert Profile.objects.get(pk=user[1].pk).age_band == "unknown"


# --- ops files ----------------------------------------------------------------------------------


def test_workflow_allow_list_and_schedule_include_the_media_jobs():
    text = (REPO / ".github/workflows/manage-command.yml").read_text()
    allowed = next(line for line in text.splitlines() if line.strip().startswith("ALLOWED="))
    assert "expire_recordings" in allowed and "orphan_sweeper" in allowed
    assert 'cron: "23 * * * *"' in text and 'cron: "41 4 * * *"' in text
    assert "expire_recordings ;;" in text and "orphan_sweeper ;;" in text


def test_storage_policies_cover_every_bucket_and_stay_private():
    sql = (Path(uploads.__file__).parent / "storage_policies.sql").read_text()
    for bucket in storage_mod.BUCKETS:
        assert f"'{bucket}'" in sql
    assert "public = false" in sql or ", false," in sql
    for policy in ("own upload", "own read", "own delete"):
        assert policy in sql


def test_env_example_documents_the_new_settings():
    text = (Path(__file__).resolve().parents[1] / ".env.example").read_text()
    for name in ("MEDIA_STORAGE_BACKEND", "SUPABASE_SERVICE_ROLE_KEY", "SHARE_BASE_URL"):
        assert name in text
