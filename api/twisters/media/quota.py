"""Storage quota: an append-only ledger, reserved and released under a per-user lock.

Why a ledger: summing `MediaAsset.size_bytes` at request time is slow and racy. Every byte that
enters or leaves a user's allowance is one `StorageLedger` row (usage = SUM(delta_bytes)), written only
while holding a row lock on the owner's Profile, so two concurrent uploads cannot both squeeze under
the limit. All functions here that write must run inside `transaction.atomic()` after `lock_profile`.
"""

from __future__ import annotations

from dataclasses import dataclass

from django.conf import settings
from django.db import connection
from django.db.models import Sum

from .. import errors
from ..models import (
    LedgerKind,
    LedgerReason,
    MediaAsset,
    Plan,
    Profile,
    Recording,
    RecordingStatus,
    StorageLedger,
)

# A failed row holds no bytes, a soft-deleted one is hidden and being removed: neither uses a slot.
_UNCOUNTED = (RecordingStatus.FAILED, RecordingStatus.DELETED)


@dataclass(frozen=True)
class Limits:
    recordings_max: int
    recording_ms_max: int
    storage_bytes_max: int
    retention_days: int
    share_max_days: int
    voice_clip_ms_max: int
    voice_clip_bytes_max: int


@dataclass(frozen=True)
class Usage:
    used_bytes: int
    count: int


def limits_for(profile: Profile) -> Limits:
    """Plan limits with settings defaults for any key the plan row omits (numbers are data, D1)."""
    plan: Plan = profile.plan
    merged = {**settings.PLAN_LIMIT_DEFAULTS, **plan.limits}
    return Limits(**{name: int(merged[name]) for name in Limits.__dataclass_fields__})


def lock_profile(profile: Profile) -> Profile:
    """Serialise this user's quota writes. Always take this lock first (same order as attempts) so
    request handlers cannot deadlock against each other."""
    if connection.in_atomic_block is False:
        raise RuntimeError("lock_profile must run inside transaction.atomic()")
    return Profile.objects.select_related("plan").select_for_update(of=("self",)).get(pk=profile.pk)


def usage(profile: Profile) -> Usage:
    used = StorageLedger.objects.filter(profile=profile).aggregate(total=Sum("delta_bytes"))[
        "total"
    ]
    count = (
        Recording.objects.filter(profile=profile, deleted_at__isnull=True)
        .exclude(status__in=_UNCOUNTED)
        .count()
    )
    return Usage(used or 0, count)


def snapshot(profile: Profile) -> dict:
    """The `quota` object returned by create and `GET /me/storage/`."""
    limits, used = limits_for(profile), usage(profile)
    return {
        "used_bytes": used.used_bytes,
        "limit_bytes": limits.storage_bytes_max,
        "count": used.count,
        "count_limit": limits.recordings_max,
    }


def asset_balance(asset: MediaAsset) -> int:
    """Bytes currently charged to one asset."""
    return (
        StorageLedger.objects.filter(asset=asset).aggregate(total=Sum("delta_bytes"))["total"] or 0
    )


def _write(
    profile: Profile, asset: MediaAsset, delta: int, kind: str, reason: str
) -> StorageLedger | None:
    if delta == 0:
        return None
    return StorageLedger.objects.create(
        profile=profile, asset=asset, delta_bytes=delta, kind=kind, reason=reason
    )


def check_can_hold(profile: Profile, limits: Limits, extra_bytes: int) -> None:
    used = usage(profile).used_bytes
    if used + extra_bytes > limits.storage_bytes_max:
        raise errors.quota_exceeded(
            "storage_bytes",
            used_bytes=used,
            limit_bytes=limits.storage_bytes_max,
            requested_bytes=extra_bytes,
        )


def check_recording_slot(profile: Profile, limits: Limits, duration_ms: int) -> None:
    if duration_ms > limits.recording_ms_max:
        raise errors.quota_exceeded(
            "recording_ms", limit_ms=limits.recording_ms_max, requested_ms=duration_ms
        )
    count = usage(profile).count
    if count >= limits.recordings_max:
        raise errors.quota_exceeded("recordings", count=count, count_limit=limits.recordings_max)


def reserve(profile: Profile, asset: MediaAsset, kind: str, size_bytes: int) -> None:
    """Charge `size_bytes` to the user, or raise 402 if it does not fit. Caller holds the lock."""
    check_can_hold(profile, limits_for(profile), size_bytes)
    _write(profile, asset, size_bytes, kind, LedgerReason.RESERVE)


def reconcile(profile: Profile, asset: MediaAsset, kind: str, actual_bytes: int) -> None:
    """Replace the reserved estimate with the measured size; growth must still fit the quota."""
    delta = actual_bytes - asset_balance(asset)
    if delta > 0:
        check_can_hold(profile, limits_for(profile), delta)
    _write(profile, asset, delta, kind, LedgerReason.COMPLETE)


def release(profile: Profile, asset: MediaAsset, kind: str, reason: str) -> None:
    """Give back everything charged to the asset (idempotent: a second call finds a zero balance)."""
    _write(profile, asset, -asset_balance(asset), kind, reason)


def charge_stored(
    profile: Profile, asset: MediaAsset, kind: str, size_bytes: int, reason: str
) -> None:
    """Charge an object that is already stored (server-written thumbnail, worker output)."""
    _write(profile, asset, size_bytes, kind, reason)


LEDGER_KIND_BY_ASSET = {
    "video": LedgerKind.RECORDING,
    "audio": LedgerKind.VOICE,
    "image": LedgerKind.THUMB,
    "caption": LedgerKind.CAPTION,
}
