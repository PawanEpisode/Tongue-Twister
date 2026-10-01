"""Recording lifecycle: create → complete → (update) → delete/restore → expire → hard delete.

Rules of the road (spec 13 §1):
* every write that touches quota takes `quota.lock_profile` first, then the row locks;
* storage I/O happens outside that lock (see `uploads`);
* soft delete hides a take and revokes its links but keeps its bytes charged until the hard delete,
  because the object still exists and the user may undo within `RESTORE_WINDOW_HOURS`;
* hard delete is a tombstone (`status=deleted`, title/notes cleared) so the ledger keeps its audit trail.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from .. import errors
from ..models import (
    ConsentType,
    JobKind,
    LedgerReason,
    MediaAsset,
    MediaKind,
    MediaStatus,
    Profile,
    Recording,
    RecordingStatus,
    ShareTarget,
    UserConsent,
)
from ..progress import achievements
from . import consent, jobs, quota, shares, uploads
from .storage import BUCKET_THUMBS, ObjectStat, StorageError, get_storage

log = logging.getLogger(__name__)

RECORDING_FLAG = uploads.CLOUD_FLAG


@dataclass(frozen=True)
class CreateResult:
    recording: Recording
    created: bool


def live(profile: Profile):
    """The owner's visible recordings. Every `{id}` route starts here, so someone else's id is a 404."""
    return Recording.objects.filter(profile=profile, deleted_at__isnull=True)


# --- create -------------------------------------------------------------------------------------


def create(profile: Profile, data: dict) -> CreateResult:
    """Reserve quota and register a recording; replaying the same `client_recording_id` returns the
    original row untouched (idempotent, so a retry after a dropped response cannot double-charge)."""
    uploads.require_cloud(profile, ConsentType.RECORDING_UPLOAD)
    uploads.check_declared(
        MediaKind.VIDEO, data["mime_type"], data["size_bytes"], settings.MEDIA_MAX_BYTES
    )
    with transaction.atomic():
        locked = quota.lock_profile(profile)
        existing = (
            Recording.objects.filter(
                profile=locked, client_recording_id=data["client_recording_id"]
            )
            .select_related("video_asset", "twister")
            .first()
        )
        if existing is not None:
            if existing.deleted_at or existing.status == RecordingStatus.DELETED:
                raise errors.ApiProblem(409, "conflict", "That recording was deleted.")
            return CreateResult(existing, created=False)

        limits = quota.limits_for(locked)
        quota.check_recording_slot(locked, limits, data["duration_ms"])
        asset = uploads.begin_upload(
            locked,
            kind=MediaKind.VIDEO,
            mime_type=data["mime_type"],
            size_bytes=data["size_bytes"],
            max_bytes=limits.storage_bytes_max,
            duration_ms=data["duration_ms"],
            width=data.get("width"),
            height=data.get("height"),
        )
        recording = Recording.objects.create(
            profile=locked,
            video_asset=asset,
            status=RecordingStatus.UPLOADING,
            consented_at=consent.require(locked, ConsentType.RECORDING_UPLOAD).granted_at,
            **data,
        )
    return CreateResult(recording, created=True)


# --- complete -----------------------------------------------------------------------------------


def _on_accepted(recording_id: uuid.UUID):
    def hook(profile: Profile, asset: MediaAsset, stat: ObjectStat) -> None:
        recording = Recording.objects.select_for_update().get(pk=recording_id)
        recording.size_bytes = stat.size
        recording.expires_at = recording.created_at + dt.timedelta(
            days=quota.limits_for(profile).retention_days
        )
        recording.save(update_fields=["size_bytes", "expires_at"])
        if settings.MEDIA_PROCESSING_ENABLED:
            recording.transition(RecordingStatus.UPLOADED)
            recording.transition(RecordingStatus.PROCESSING)
            asset.transition(MediaStatus.PROCESSING)
            jobs.enqueue(recording, JobKind.PROCESS, asset)
        else:  # no worker yet: the uploaded file is what we play (PRD 04 §10)
            recording.transition(RecordingStatus.UPLOADED)
            recording.transition(RecordingStatus.READY)
            asset.transition(MediaStatus.READY)

    return hook


def _on_rejected(recording_id: uuid.UUID):
    def hook(profile: Profile, asset: MediaAsset, reason: str) -> None:
        recording = Recording.objects.select_for_update().get(pk=recording_id)
        recording.transition(RecordingStatus.FAILED, failure_reason=reason[:60])

    return hook


def complete(
    profile: Profile,
    recording: Recording,
    *,
    checksum: str | None = None,
    thumbnail: bytes | None = None,
) -> tuple[Recording, bool]:
    """Verify the upload and make the recording playable. Returns (recording, changed): `changed` is
    False on a repeat call, which the view reports as 200 instead of 202."""
    asset = recording.video_asset
    if asset is None:
        raise errors.gone()
    changed = uploads.finalize_upload(
        profile,
        asset,
        checksum=checksum,
        on_accepted=_on_accepted(recording.pk),
        on_rejected=_on_rejected(recording.pk),
    )
    recording.refresh_from_db()
    if changed and thumbnail:
        attach_thumbnail(profile, recording, thumbnail)
        recording.refresh_from_db()
    if changed:
        award_achievements(profile)
    return recording, changed


def award_achievements(profile: Profile) -> None:
    """Evaluate the `recording` event. The unlocks are not returned (the `complete` response is a
    recording); the web app reads them from `unseen_achievements` in `GET /me/summary/`."""
    with transaction.atomic():
        achievements.safely(achievements.Event(achievements.RECORDING, quota.lock_profile(profile)))


def attach_thumbnail(profile: Profile, recording: Recording, jpeg: bytes) -> bool:
    """Best effort: a missing thumbnail must never fail a recording that uploaded fine."""
    if recording.thumbnail_asset_id:
        return False
    asset_id, now = uuid.uuid4(), timezone.now()
    path = uploads.object_path(profile.pk, asset_id, "jpg", now)
    try:
        get_storage().put(BUCKET_THUMBS, path, jpeg, "image/jpeg")
    except StorageError:
        log.warning("recording.thumbnail_failed recording=%s", recording.pk)
        return False
    with transaction.atomic():
        locked = quota.lock_profile(profile)
        try:
            quota.check_can_hold(locked, quota.limits_for(locked), len(jpeg))
        except errors.ApiProblem:
            skip = True
        else:
            skip = False
            asset = MediaAsset.objects.create(
                id=asset_id,
                profile=locked,
                kind=MediaKind.IMAGE,
                bucket=BUCKET_THUMBS,
                path=path,
                mime_type="image/jpeg",
                size_bytes=len(jpeg),
                status=MediaStatus.READY,
            )
            quota.charge_stored(
                locked, asset, quota.LEDGER_KIND_BY_ASSET["image"], len(jpeg), LedgerReason.COMPLETE
            )
            Recording.objects.filter(pk=recording.pk).update(thumbnail_asset=asset)
    if skip:
        get_storage().delete(BUCKET_THUMBS, path)
    return not skip


# --- delete / restore ---------------------------------------------------------------------------


def soft_delete(profile: Profile, recording: Recording, now: dt.datetime | None = None) -> None:
    """Hide the take and kill its links now; the bytes stay charged until `hard_delete_due`."""
    with transaction.atomic():
        quota.lock_profile(profile)
        fresh = Recording.objects.select_for_update().get(pk=recording.pk)
        if fresh.deleted_at is None:
            fresh.deleted_at = now or timezone.now()
            fresh.save(update_fields=["deleted_at"])
            shares.revoke_for_target(ShareTarget.RECORDING, fresh.pk)
    recording.deleted_at = fresh.deleted_at


def restore(profile: Profile, recording: Recording) -> Recording:
    """Undo a soft delete within the window. Needs the same consent and a free slot as a new take."""
    consent.require(profile, ConsentType.RECORDING_UPLOAD)
    with transaction.atomic():
        locked = quota.lock_profile(profile)
        fresh = Recording.objects.select_for_update().get(pk=recording.pk)
        cutoff = timezone.now() - dt.timedelta(hours=settings.RESTORE_WINDOW_HOURS)
        if fresh.status == RecordingStatus.DELETED or (
            fresh.deleted_at and fresh.deleted_at < cutoff
        ):
            raise errors.gone("This recording can no longer be restored.")
        if fresh.deleted_at is not None:
            limits = quota.limits_for(locked)
            if quota.usage(locked).count >= limits.recordings_max:
                raise errors.quota_exceeded("recordings", count_limit=limits.recordings_max)
            fresh.deleted_at = None
            fresh.save(update_fields=["deleted_at"])
    return fresh


def retry_processing(profile: Profile, recording: Recording) -> Recording:
    """Re-run processing for a take whose processing failed (its bytes are still stored)."""
    with transaction.atomic():
        quota.lock_profile(profile)
        fresh = Recording.objects.select_for_update().get(pk=recording.pk)
        asset = MediaAsset.objects.select_for_update().filter(pk=fresh.video_asset_id).first()
        if (
            fresh.status != RecordingStatus.FAILED
            or asset is None
            or quota.asset_balance(asset) <= 0
        ):
            raise errors.ApiProblem(
                409, "conflict", "Nothing to retry; upload the recording again."
            )
        fresh.failure_reason = ""
        if settings.MEDIA_PROCESSING_ENABLED:
            fresh.transition(RecordingStatus.PROCESSING, failure_reason="")
            asset.transition(MediaStatus.PROCESSING)
            jobs.enqueue(fresh, JobKind.PROCESS, asset)
        else:  # no worker: the stored upload is the playable file
            fresh.transition(RecordingStatus.UPLOADED, failure_reason="")
            fresh.transition(RecordingStatus.READY)
            asset.transition(MediaStatus.UPLOADED)
            asset.transition(MediaStatus.READY)
    return fresh


# --- jobs ---------------------------------------------------------------------------------------


def expire_due(now: dt.datetime | None = None) -> int:
    """Soft-delete recordings past `expires_at` (hourly job)."""
    now = now or timezone.now()
    due = Recording.objects.filter(deleted_at__isnull=True, expires_at__lte=now).select_related(
        "profile"
    )
    count = 0
    for recording in due.iterator():
        soft_delete(recording.profile, recording, now)
        count += 1
    return count


def _derived_assets(recording: Recording) -> list[MediaAsset]:
    return [
        a
        for a in (
            recording.video_asset,
            recording.thumbnail_asset,
            recording.captions_asset,
            recording.audio_asset,
        )
        if a is not None
    ]


def hard_delete_due(now: dt.datetime | None = None, *, profile: Profile | None = None) -> int:
    """Purge recordings soft-deleted longer than the restore window: objects, ledger, then tombstone.
    ``profile`` limits the pass to one owner (account purge); the hourly job passes nothing."""
    now = now or timezone.now()
    cutoff = now - dt.timedelta(hours=settings.RESTORE_WINDOW_HOURS)
    due = (
        Recording.objects.filter(deleted_at__lte=cutoff)
        .exclude(status=RecordingStatus.DELETED)
        .select_related(
            "profile", "video_asset", "thumbnail_asset", "captions_asset", "audio_asset"
        )
    )
    if profile is not None:
        due = due.filter(profile=profile)
    count = 0
    for recording in due.iterator():
        expired = recording.expires_at is not None and recording.expires_at <= recording.deleted_at
        reason = LedgerReason.EXPIRE if expired else LedgerReason.DELETE
        if not all(uploads.purge_asset(a, reason) for a in _derived_assets(recording)):
            continue  # storage refused; retry next run rather than lose track of the object
        recording.title = recording.notes = ""
        recording.layout_settings, recording.crop_rect = {}, None
        recording.save(update_fields=["title", "notes", "layout_settings", "crop_rect"])
        recording.transition(RecordingStatus.DELETED)
        count += 1
    return count


def purge_expired_assets(now: dt.datetime | None = None, *, profile: Profile | None = None) -> int:
    """Delete stand-alone assets (voice clips) whose `expires_at` has passed (one owner's, if given)."""
    now = now or timezone.now()
    due = (
        MediaAsset.objects.filter(
            expires_at__lte=now, deleted_at__isnull=True, kind=MediaKind.AUDIO
        )
        .exclude(status=MediaStatus.DELETED)
        .select_related("profile")
    )
    if profile is not None:
        due = due.filter(profile=profile)
    return sum(1 for asset in due.iterator() if uploads.purge_asset(asset, LedgerReason.EXPIRE))


def sweep_orphans(now: dt.datetime | None = None) -> int:
    """Uploads that never completed within `MEDIA_ORPHAN_HOURS`: free the reservation and the object."""
    now = now or timezone.now()
    cutoff = now - dt.timedelta(hours=settings.MEDIA_ORPHAN_HOURS)
    stale = MediaAsset.objects.filter(
        status__in=uploads.AWAITING, created_at__lt=cutoff
    ).select_related("profile")
    count = 0
    for asset in stale.iterator():
        if not uploads.purge_asset(asset, LedgerReason.ORPHAN):
            continue
        Recording.objects.filter(video_asset=asset, deleted_at__isnull=True).update(
            status=RecordingStatus.FAILED, failure_reason="upload_abandoned", deleted_at=now
        )
        count += 1
    return count


def enforce_consent_revocations(now: dt.datetime | None = None) -> int:
    """After the grace period, remove media whose consent was revoked and not re-granted (D14)."""
    now = now or timezone.now()
    cutoff = now - dt.timedelta(hours=settings.CONSENT_REVOCATION_GRACE_HOURS)
    count = 0
    for consent_type, remove in (
        (ConsentType.RECORDING_UPLOAD, _soft_delete_recordings_before),
        (ConsentType.VOICE_STORAGE, _purge_voice_before),
        (ConsentType.VOICE_PROCESSING, _purge_analysis_audio_before),
    ):
        still_active = UserConsent.objects.filter(
            type=consent_type, revoked_at__isnull=True
        ).values("profile_id")
        revoked = (
            UserConsent.objects.filter(type=consent_type, revoked_at__lte=cutoff)
            .exclude(profile_id__in=still_active)
            .values("profile_id")
            .annotate(latest=Max("revoked_at"))
        )
        for row in revoked:
            profile = Profile.objects.select_related("plan").get(pk=row["profile_id"])
            count += remove(profile, row["latest"], now)
    return count


def _soft_delete_recordings_before(
    profile: Profile, revoked_at: dt.datetime, now: dt.datetime
) -> int:
    rows = list(live(profile).filter(consented_at__lte=revoked_at))
    for recording in rows:
        soft_delete(profile, recording, now)
    return len(rows)


def _purge_voice_before(profile: Profile, revoked_at: dt.datetime, now: dt.datetime) -> int:
    rows = MediaAsset.objects.filter(
        profile=profile, kind=MediaKind.AUDIO, created_at__lte=revoked_at
    ).exclude(status=MediaStatus.DELETED)
    return sum(1 for asset in rows if uploads.purge_asset(asset, LedgerReason.DELETE))


def _purge_analysis_audio_before(
    profile: Profile, revoked_at: dt.datetime, now: dt.datetime
) -> int:
    """Audio the worker extracted for analysis goes when `voice_processing` consent is withdrawn."""
    rows = MediaAsset.objects.filter(
        profile=profile, analysis_audio_of__isnull=False, created_at__lte=revoked_at
    ).exclude(status=MediaStatus.DELETED)
    return sum(1 for asset in rows if uploads.purge_asset(asset, LedgerReason.DELETE))


def purge_profile_media(profile: Profile) -> None:
    """Account deletion (D14): hide everything now and queue the hard delete for the next job run.

    Recordings are backdated past the restore window (and voice clips expired) so the same hourly
    passes that handle normal deletion remove the objects; nothing here waits on storage.
    """
    now = timezone.now()
    backdated = now - dt.timedelta(hours=settings.RESTORE_WINDOW_HOURS + 1)
    with transaction.atomic():
        quota.lock_profile(profile)
        Recording.objects.filter(profile=profile).exclude(status=RecordingStatus.DELETED).update(
            deleted_at=backdated
        )
        MediaAsset.objects.filter(profile=profile, kind=MediaKind.AUDIO).exclude(
            status=MediaStatus.DELETED
        ).update(expires_at=now)
        shares.revoke_for_creator(profile)


def purge_all_media(profile: Profile) -> bool:
    """Account purge (D21): remove every stored object of ``profile`` right now, inline.

    Runs the same passes the hourly job runs (`purge_profile_media` queues, `hard_delete_due` and
    `purge_expired_assets` execute) scoped to one owner, then sweeps any asset those passes cannot
    reach (an abandoned upload, a clip with no recording). Returns True only when no object is left;
    False means storage refused something and the caller must keep the account and retry later.
    """
    purge_profile_media(profile)
    hard_delete_due(profile=profile)
    purge_expired_assets(profile=profile)
    leftovers = MediaAsset.objects.filter(profile=profile).exclude(status=MediaStatus.DELETED)
    return all([uploads.purge_asset(asset, LedgerReason.DELETE) for asset in leftovers])
