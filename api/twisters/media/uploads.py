"""Create and verify uploads. Shared by cloud recordings and voice clips so the rules exist once.

Flow: `begin_upload` (DB: asset row + quota reserve, under the owner's lock) → `sign_upload` (storage:
mint credentials, after the lock is released) → the client uploads straight to storage → `verify_object`
(storage: stat + first-bytes sniff, *before* taking the lock) → `accept_object` / `reject_object` (DB,
under the lock). Keeping network calls outside the lock means a slow storage API can never stall the
user's other writes.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import logging
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import status

from .. import errors
from ..models import (
    Attempt,
    ConsentType,
    LedgerReason,
    MediaAsset,
    MediaKind,
    MediaStatus,
    Profile,
    ScoringJob,
)
from ..practice import flags
from . import consent, quota
from .storage import (
    BUCKET_CAPTIONS,
    BUCKET_RECORDINGS,
    BUCKET_THUMBS,
    BUCKET_VOICE,
    ObjectStat,
    SignedUpload,
    StorageError,
    get_storage,
)

log = logging.getLogger(__name__)

SNIFF_BYTES = 16


def _is_ebml(head: bytes) -> bool:  # WebM / Matroska
    return head.startswith(b"\x1a\x45\xdf\xa3")


def _is_iso_bmff(head: bytes) -> bool:  # MP4 / M4A: 4-byte size then "ftyp"
    return head[4:8] == b"ftyp"


def _is_ogg(head: bytes) -> bool:
    return head.startswith(b"OggS")


def _is_wav(head: bytes) -> bool:
    return head.startswith(b"RIFF") and head[8:12] == b"WAVE"


def _is_jpeg(head: bytes) -> bool:
    return head.startswith(b"\xff\xd8\xff")


def _is_vtt(head: bytes) -> bool:
    return head.lstrip(b"\xef\xbb\xbf").startswith(b"WEBVTT")


@dataclass(frozen=True)
class MimeRule:
    kind: str
    bucket: str
    ext: str
    sniff: Callable[[bytes], bool]


# The only content types we accept, with where they live and how their first bytes must look.
MIME_RULES: dict[str, MimeRule] = {
    "video/webm": MimeRule(MediaKind.VIDEO, BUCKET_RECORDINGS, "webm", _is_ebml),
    "video/mp4": MimeRule(MediaKind.VIDEO, BUCKET_RECORDINGS, "mp4", _is_iso_bmff),
    "audio/webm": MimeRule(MediaKind.AUDIO, BUCKET_VOICE, "webm", _is_ebml),
    "audio/mp4": MimeRule(MediaKind.AUDIO, BUCKET_VOICE, "m4a", _is_iso_bmff),
    "audio/ogg": MimeRule(MediaKind.AUDIO, BUCKET_VOICE, "ogg", _is_ogg),
    "audio/wav": MimeRule(MediaKind.AUDIO, BUCKET_VOICE, "wav", _is_wav),
    "image/jpeg": MimeRule(MediaKind.IMAGE, BUCKET_THUMBS, "jpg", _is_jpeg),
    "text/vtt": MimeRule(MediaKind.CAPTION, BUCKET_CAPTIONS, "vtt", _is_vtt),
}

_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class UploadRejected(Exception):
    """The stored object is not what the client declared. `reason` becomes `failure_reason`."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def base_mime(mime_type: str) -> str:
    """`video/webm;codecs=vp9,opus` → `video/webm`."""
    return mime_type.split(";", 1)[0].strip().lower()


def rule_for(mime_type: str, kind: str) -> MimeRule:
    """The accepted-type rule, or 415. `kind` pins the category so a video cannot pose as a voice clip."""
    rule = MIME_RULES.get(base_mime(mime_type))
    if rule is None or rule.kind != kind:
        raise errors.ApiProblem(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            "That file type is not supported.",
        )
    return rule


def owner_folder(profile_id: uuid.UUID) -> str:
    """Opaque per-owner folder: the first 16 hex chars of HMAC-SHA256(MEDIA_PATH_SECRET, profile_id).

    The only place a storage folder name is derived. It is stable per owner (so a folder listing in the
    dashboard still groups a user's files) but reveals neither the profile id nor anything guessable, and
    storage RLS therefore cannot (and does not) rely on it: clients get no direct access at all.
    """
    digest = hmac.new(
        settings.MEDIA_PATH_SECRET.encode(), str(profile_id).encode(), hashlib.sha256
    ).hexdigest()
    return digest[:16]


def object_path(profile_id: uuid.UUID, asset_id: uuid.UUID, ext: str, now: dt.datetime) -> str:
    """`{owner_folder}/{yyyy}/{mm}/{asset_id}.{ext}` (assets created before the opaque-path change keep
    their old `{profile_id}/...` path: the path is stored per asset)."""
    return f"{owner_folder(profile_id)}/{now:%Y}/{now:%m}/{asset_id}.{ext}"


def check_declared(kind: str, mime_type: str, size_bytes: int, max_bytes: int) -> MimeRule:
    """Reject an unsupported type (415) or oversized file (413) before touching the database."""
    rule = rule_for(mime_type, kind)
    if size_bytes > min(max_bytes, settings.MEDIA_MAX_BYTES):
        raise errors.ApiProblem(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "too_large", "That file is too large."
        )
    return rule


def begin_upload(
    profile: Profile,
    *,
    kind: str,
    mime_type: str,
    size_bytes: int,
    max_bytes: int,
    duration_ms: int | None = None,
    width: int | None = None,
    height: int | None = None,
    expires_at: dt.datetime | None = None,
) -> MediaAsset:
    """Create the asset row and reserve its bytes. The caller holds `quota.lock_profile`."""
    rule = check_declared(kind, mime_type, size_bytes, max_bytes)
    asset_id, now = uuid.uuid4(), timezone.now()
    asset = MediaAsset.objects.create(
        id=asset_id,
        profile=profile,
        kind=kind,
        bucket=rule.bucket,
        path=object_path(profile.pk, asset_id, rule.ext, now),
        mime_type=base_mime(mime_type),
        size_bytes=size_bytes,
        duration_ms=duration_ms,
        width=width,
        height=height,
        expires_at=expires_at,
    )
    quota.reserve(profile, asset, quota.LEDGER_KIND_BY_ASSET[kind], size_bytes)
    return asset


def mint_upload(
    bucket: str, path: str, mime_type: str, *, ttl_s: int | None = None, upsert: bool = False
) -> SignedUpload:
    """Upload credentials for one object (storage call; do not hold the quota lock)."""
    try:
        return get_storage().create_upload(
            bucket, path, mime_type, ttl_s or settings.UPLOAD_URL_TTL_S, upsert=upsert
        )
    except StorageError as exc:
        raise errors.dependency_unavailable("Upload storage is unavailable; try again.") from exc


def mint_download(bucket: str, path: str, ttl_s: int) -> str:
    """A signed read URL for one object; storage failure is a 503, never a silent empty URL."""
    try:
        return get_storage().signed_url(bucket, path, ttl_s)
    except StorageError as exc:
        raise errors.dependency_unavailable("Storage is unavailable; try again.") from exc


def sign_upload(asset: MediaAsset) -> SignedUpload:
    signed = mint_upload(asset.bucket, asset.path, asset.mime_type)
    MediaAsset.objects.filter(pk=asset.pk).update(upload_attempts=F("upload_attempts") + 1)
    return signed


def upload_incomplete() -> errors.ApiProblem:
    return errors.ApiProblem(
        status.HTTP_409_CONFLICT, "upload_incomplete", "The upload has not finished yet."
    )


def verify_object(
    asset: MediaAsset, *, checksum: str | None = None, max_bytes: int | None = None
) -> ObjectStat:
    """Check the stored object matches what was declared. Storage I/O only, so call it *before*
    taking the quota lock. Raises `UploadRejected` for bad content and 409 when nothing is there yet.
    `max_bytes` overrides the per-kind ceiling for server-made files (e.g. analysis WAVs)."""
    if checksum is not None and not _SHA256.match(checksum):
        raise UploadRejected("checksum_invalid")
    storage = get_storage()
    try:
        stat = storage.stat(asset.bucket, asset.path)
        if stat is None:
            raise upload_incomplete()
        if stat.size <= 0 or stat.size > min(
            settings.MEDIA_MAX_BYTES, max_bytes or asset_limit(asset)
        ):
            raise UploadRejected("size_out_of_range")
        head = storage.read_head(asset.bucket, asset.path, SNIFF_BYTES)
    except StorageError as exc:
        raise errors.dependency_unavailable("Upload storage is unavailable; try again.") from exc
    rule = MIME_RULES[asset.mime_type]
    if not rule.sniff(head):
        raise UploadRejected("not_media")
    if checksum and stat.checksum_sha256 and checksum != stat.checksum_sha256:
        raise UploadRejected("checksum_mismatch")
    return ObjectStat(stat.size, stat.mime_type, stat.checksum_sha256 or checksum)


def asset_limit(asset: MediaAsset) -> int:
    """Per-object byte ceiling for the asset's owner and kind (plan data, D1)."""
    limits = quota.limits_for(asset.profile)
    if asset.kind == MediaKind.AUDIO:
        return limits.voice_clip_bytes_max
    if asset.kind == MediaKind.IMAGE:
        return settings.THUMBNAIL_MAX_BYTES
    return limits.storage_bytes_max


def accept_object(profile: Profile, asset: MediaAsset, stat: ObjectStat) -> None:
    """Record the verified size (may raise 402 if the real size no longer fits) and mark the asset
    uploaded. Caller holds the lock and is in a transaction."""
    quota.reconcile(profile, asset, quota.LEDGER_KIND_BY_ASSET[asset.kind], stat.size)
    asset.size_bytes = stat.size
    asset.checksum_sha256 = stat.checksum_sha256 or ""
    asset.save(update_fields=["size_bytes", "checksum_sha256"])
    asset.transition(MediaStatus.UPLOADED)


def reject_object(profile: Profile, asset: MediaAsset, reason: str) -> None:
    """Give the bytes back and mark the asset failed. The stored object is deleted by the caller
    *after* the transaction (`discard_object`) so a storage outage cannot roll the rejection back."""
    quota.release(profile, asset, quota.LEDGER_KIND_BY_ASSET[asset.kind], LedgerReason.REJECT)
    if asset.status != MediaStatus.FAILED:
        asset.transition(MediaStatus.FAILED)
    log.info("media.rejected asset=%s reason=%s", asset.pk, reason)


def discard_object(asset: MediaAsset) -> bool:
    """Best-effort delete of the stored object. False means it is still there (retry later)."""
    try:
        get_storage().delete(asset.bucket, asset.path)
    except StorageError:
        return False
    return True


def purge_asset(asset: MediaAsset, reason: str = LedgerReason.DELETE) -> bool:
    """Hard delete: remove the object, give back its bytes, tombstone the row, detach references.

    Idempotent. If storage refuses, nothing changes and False is returned so the job retries the
    asset on its next run instead of releasing quota for bytes that still exist.
    """
    if asset.status == MediaStatus.DELETED:
        return True
    if not discard_object(asset):
        return False
    with transaction.atomic():
        profile = quota.lock_profile(asset.profile)
        fresh = MediaAsset.objects.select_for_update().get(pk=asset.pk)
        quota.release(profile, fresh, quota.LEDGER_KIND_BY_ASSET[fresh.kind], reason)
        fresh.transition(MediaStatus.DELETED, deleted_at=timezone.now())
        Attempt.objects.filter(voice_asset=fresh).update(voice_asset=None)
        ScoringJob.objects.filter(audio_asset=fresh).update(audio_asset=None)
    asset.status, asset.deleted_at = fresh.status, fresh.deleted_at
    return True


def owned_audio_asset(profile: Profile, asset_id: uuid.UUID) -> MediaAsset | None:
    """A ready voice clip belonging to `profile`, for attaching to an attempt; None otherwise (the
    caller answers "not found" whether it is missing or someone else's)."""
    return MediaAsset.objects.filter(
        pk=asset_id, profile=profile, kind=MediaKind.AUDIO, status=MediaStatus.READY
    ).first()


# --- shared finalisation ------------------------------------------------------------------------

AWAITING = (MediaStatus.PENDING_UPLOAD, MediaStatus.UPLOADING)
FINALISED = (MediaStatus.UPLOADED, MediaStatus.PROCESSING, MediaStatus.READY)
CLOUD_FLAG = "record_cloud"

AcceptHook = Callable[[Profile, MediaAsset, ObjectStat], None]
RejectHook = Callable[[Profile, MediaAsset, str], None]


def upload_rejected(reason: str) -> errors.ApiProblem:
    return errors.ApiProblem(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "upload_rejected",
        "The uploaded file was rejected.",
        {"reason": reason},
    )


def require_cloud(profile: Profile, consent_type: str) -> None:
    """The gates every cloud upload passes, in a fixed order: kill switch, age (D6), consent."""
    if not flags.enabled(CLOUD_FLAG, profile):
        raise errors.feature_disabled("Cloud saving is not available right now.")
    consent.require_adult(profile)
    consent.require(profile, consent_type)


def finalize_upload(
    profile: Profile,
    asset: MediaAsset,
    *,
    checksum: str | None,
    on_accepted: AcceptHook,
    on_rejected: RejectHook | None = None,
) -> bool:
    """Verify the uploaded object and settle its quota. True if this call finalised it, False if it
    already was (safe to call repeatedly). Rejections are committed *before* the error is raised, so
    the failed state, the released bytes and the deleted object are never rolled back with it."""
    if asset.status in FINALISED:
        return False
    if asset.status == MediaStatus.FAILED:
        raise upload_rejected("previously_rejected")
    if asset.status not in AWAITING:
        raise errors.gone()

    rejection: UploadRejected | None = None
    stat: ObjectStat | None = None
    try:
        stat = verify_object(asset, checksum=checksum)
    except UploadRejected as exc:
        rejection = exc

    failure: errors.ApiProblem | None = None
    with transaction.atomic():
        locked = quota.lock_profile(profile)
        fresh = MediaAsset.objects.select_for_update().get(pk=asset.pk)
        if fresh.status not in AWAITING:
            return False  # another request finalised it while we were checking the object
        if rejection is None and stat is not None:
            try:
                accept_object(locked, fresh, stat)
            except errors.ApiProblem as problem:  # the real size no longer fits the quota
                rejection, failure = UploadRejected("quota_exceeded"), problem
        if rejection is not None:
            reject_object(locked, fresh, rejection.reason)
            if on_rejected:
                on_rejected(locked, fresh, rejection.reason)
            failure = failure or upload_rejected(rejection.reason)
        elif stat is not None:
            on_accepted(locked, fresh, stat)
    asset.refresh_from_db()
    if failure is not None:
        discard_object(asset)
        raise failure
    return True


# --- voice clips --------------------------------------------------------------------------------


SPOT_CHECK_FLAG = "spot_checks"


def require_spot_check_upload(profile: Profile) -> None:
    """Gates for the short-lived clip a spot-check needs (docs/features/13 §3.3): the spot-check kill
    switch, age (D6) and `voice_processing` consent. Deliberately not the `record_cloud` / `voice_storage`
    gates: this clip is deleted when the check settles (D41) and is never offered for playback."""
    if not flags.enabled(SPOT_CHECK_FLAG, profile):
        raise errors.feature_disabled("Verification is not available right now.")
    consent.require_adult(profile)
    consent.require(profile, ConsentType.VOICE_PROCESSING)


def create_voice(
    profile: Profile,
    *,
    mime_type: str,
    size_bytes: int,
    duration_ms: int,
    spot_check: bool = False,
) -> MediaAsset:
    """Reserve an opt-in cloud copy of a Speak & score clip (auto-expires; ERD 06c), or, with
    ``spot_check``, the temporary clip a worker re-scores (expires in `SPOT_CHECK_AUDIO_TTL_H`)."""
    if spot_check:
        require_spot_check_upload(profile)
    else:
        require_cloud(profile, ConsentType.VOICE_STORAGE)
    with transaction.atomic():
        locked = quota.lock_profile(profile)
        limits = quota.limits_for(locked)
        if duration_ms > limits.voice_clip_ms_max:
            raise errors.ApiProblem(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "too_large", "That clip is too long."
            )
        return begin_upload(
            locked,
            kind=MediaKind.AUDIO,
            mime_type=mime_type,
            size_bytes=size_bytes,
            max_bytes=limits.voice_clip_bytes_max,
            duration_ms=duration_ms,
            expires_at=timezone.now()
            + (
                dt.timedelta(hours=settings.SPOT_CHECK_AUDIO_TTL_H)
                if spot_check
                else dt.timedelta(days=settings.VOICE_RETENTION_DAYS)
            ),
        )


def complete_voice(profile: Profile, asset: MediaAsset, *, checksum: str | None) -> bool:
    def ready(_profile: Profile, fresh: MediaAsset, _stat: ObjectStat) -> None:
        fresh.transition(MediaStatus.READY)

    return finalize_upload(profile, asset, checksum=checksum, on_accepted=ready)
