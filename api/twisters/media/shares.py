"""Unlisted share links (decision D2; ERD 06c "Share access").

The token is 128 random bits shown to the owner exactly once; only its sha256 is stored, so a database
leak yields no working links. Resolution hashes the presented token, looks it up by the unique hash and
then compares in constant time. Anything that stops a link working (expiry, revoke, moderation hold,
target deleted/hidden) resolves to `410 gone` with no metadata; only an unknown token is `404`.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import secrets
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import NotFound

from .. import errors
from ..models import (
    Attempt,
    Recording,
    RecordingStatus,
    ShareLink,
    ShareTarget,
)

EXPIRY_CHOICES: dict[str, dt.timedelta] = {
    "24h": dt.timedelta(hours=24),
    "7d": dt.timedelta(days=7),
    "30d": dt.timedelta(days=30),
}


@dataclass(frozen=True)
class Resolved:
    link: ShareLink
    recording: Recording | None = None
    attempt: Attempt | None = None


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def mint_token() -> str:
    """22 URL-safe characters = 128 bits of entropy."""
    return secrets.token_urlsafe(16)


def share_url(kind: str, token: str) -> str:
    prefix = "r" if kind == ShareTarget.RECORDING else "s"
    return f"{settings.SHARE_BASE_URL}/{prefix}/{token}"


def _create(profile, target_type: str, target_id, expires_at: dt.datetime) -> tuple[ShareLink, str]:
    """Insert the link and return it with the raw token (never persisted)."""
    active = ShareLink.objects.filter(
        created_by=profile,
        target_type=target_type,
        target_id=target_id,
        revoked_at__isnull=True,
        expires_at__gt=timezone.now(),
    ).count()
    if active >= settings.SHARE_MAX_ACTIVE_PER_TARGET:
        raise errors.ApiProblem(409, "conflict", "Too many active links; revoke one first.")
    token = mint_token()
    link = ShareLink.objects.create(
        target_type=target_type,
        target_id=target_id,
        token_hash=hash_token(token),
        created_by=profile,
        expires_at=expires_at,
    )
    return link, token


def create_for_recording(
    profile, recording: Recording, expires_in: str, max_days: int
) -> tuple[ShareLink, str]:
    """A link to a ready, visible recording. `max_days` is the plan's `share_max_days`."""
    delta = EXPIRY_CHOICES[expires_in]
    if delta > dt.timedelta(days=max_days):
        raise errors.quota_exceeded("share_max_days", limit_days=max_days)
    with transaction.atomic():
        fresh = Recording.objects.select_for_update().get(pk=recording.pk)
        if fresh.deleted_at or fresh.status != RecordingStatus.READY:
            raise errors.ApiProblem(409, "conflict", "This recording is not ready to share.")
        held = ShareLink.objects.filter(
            target_type=ShareTarget.RECORDING, target_id=fresh.pk, hidden_at__isnull=False
        ).exists()
        if fresh.hidden_at or held:
            raise errors.ApiProblem(409, "conflict", "This recording cannot be shared.")
        return _create(profile, ShareTarget.RECORDING, fresh.pk, timezone.now() + delta)


def create_for_score_card(profile, attempt: Attempt) -> tuple[ShareLink, str]:
    expires_at = timezone.now() + dt.timedelta(days=settings.SCORE_CARD_SHARE_DAYS)
    return _create(profile, ShareTarget.SCORE_CARD, attempt.public_id, expires_at)


def revoke(link: ShareLink) -> None:
    if link.revoked_at is None:
        link.revoked_at = timezone.now()
        link.save(update_fields=["revoked_at"])


def revoke_for_target(target_type: str, target_id) -> int:
    return ShareLink.objects.filter(
        target_type=target_type, target_id=target_id, revoked_at__isnull=True
    ).update(revoked_at=timezone.now())


def hold_for_target(target_type: str, target_id) -> int:
    """Moderation hold on every link to a target (staff action)."""
    return ShareLink.objects.filter(
        target_type=target_type, target_id=target_id, hidden_at__isnull=True
    ).update(hidden_at=timezone.now())


def _link_usable(link: ShareLink, now: dt.datetime) -> bool:
    return link.revoked_at is None and link.hidden_at is None and link.expires_at > now


def resolve(token: str, target_type: str, *, count_view: bool = True) -> Resolved:
    """Token → live target, or 404 (unknown) / 410 (no longer available)."""
    digest = hash_token(token)
    link = ShareLink.objects.filter(token_hash=digest, target_type=target_type).first()
    if link is None or not hmac.compare_digest(link.token_hash, digest):
        raise NotFound()
    now = timezone.now()
    if not _link_usable(link, now):
        raise errors.gone()
    if target_type == ShareTarget.RECORDING:
        recording = (
            Recording.objects.select_related("twister", "profile", "attempt", "video_asset")
            .filter(pk=link.target_id)
            .first()
        )
        if (
            recording is None
            or recording.deleted_at
            or recording.hidden_at
            or recording.status != RecordingStatus.READY
        ):
            raise errors.gone()
        resolved = Resolved(link, recording=recording)
    else:
        attempt = (
            Attempt.objects.select_related("twister", "profile")
            .filter(public_id=link.target_id)
            .first()
        )
        if attempt is None:
            raise errors.gone()
        resolved = Resolved(link, attempt=attempt)
    if count_view:
        ShareLink.objects.filter(pk=link.pk).update(
            view_count=F("view_count") + 1, last_viewed_at=now
        )
    return resolved
