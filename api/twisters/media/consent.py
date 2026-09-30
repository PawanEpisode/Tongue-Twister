"""Consent log rules (ERD 06c "Behaviour rules"; decision D6).

A consent is *active* while `revoked_at IS NULL`; the partial unique index guarantees at most one
active row per (profile, type). Granting a newer version retires the old row rather than editing it, so
the log stays an audit trail. "Current" means the version in `settings.CONSENT_VERSIONS`: bumping it
makes older consents insufficient without deleting anything.
"""

from __future__ import annotations

import datetime as dt

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from .. import errors
from ..models import AgeBand, ConsentType, Profile, UserConsent


def current_version(consent_type: str) -> str:
    return settings.CONSENT_VERSIONS[consent_type]


def active(profile: Profile, consent_type: str) -> UserConsent | None:
    return UserConsent.objects.filter(
        profile=profile, type=consent_type, revoked_at__isnull=True
    ).first()


def active_current(profile: Profile, consent_type: str) -> UserConsent | None:
    """The active consent, only if it is for the version users are being asked to accept now."""
    found = active(profile, consent_type)
    return found if found and found.version == current_version(consent_type) else None


def require(profile: Profile, consent_type: str) -> UserConsent:
    found = active_current(profile, consent_type)
    if found is None:
        label = ConsentType(consent_type).label.lower()
        raise errors.consent_required(f"Consent to {label} is required first.")
    return found


def require_adult(profile: Profile) -> None:
    """Cloud media, voice uploads and audio donation need a declared age of 13+ (decision D6)."""
    if profile.age_band == AgeBand.UNDER13:
        raise errors.minor_not_allowed()
    if profile.age_band != AgeBand.ADULT:
        raise errors.age_required()


def require_not_minor(profile: Profile) -> None:
    """Weaker than `require_adult`: only a declared under-13 is refused (audio donation, D6)."""
    if profile.age_band == AgeBand.UNDER13:
        raise errors.minor_not_allowed()


def grant(
    profile: Profile, consent_type: str, version: str, ip_hash: str
) -> tuple[UserConsent, bool]:
    """Idempotently record consent. Returns (row, created); the same active version is a no-op."""
    for _ in range(2):  # the second pass only runs if a concurrent grant won the unique index
        try:
            with transaction.atomic():
                existing = (
                    UserConsent.objects.select_for_update()
                    .filter(profile=profile, type=consent_type, revoked_at__isnull=True)
                    .first()
                )
                if existing and existing.version == version:
                    return existing, False
                if existing:
                    existing.revoked_at = timezone.now()
                    existing.save(update_fields=["revoked_at"])
                row = UserConsent.objects.create(
                    profile=profile, type=consent_type, version=version, ip_hash=ip_hash
                )
                return row, True
        except IntegrityError:
            continue
    return active(profile, consent_type), False  # type: ignore[return-value]


def revoke(profile: Profile, consent_type: str) -> UserConsent | None:
    """Stamp `revoked_at` on the active consent. Dependent media is removed by the jobs after the grace
    period (`recordings.enforce_consent_revocations`), giving the user a window to change their mind."""
    with transaction.atomic():
        row = (
            UserConsent.objects.select_for_update()
            .filter(profile=profile, type=consent_type, revoked_at__isnull=True)
            .first()
        )
        if row is None:
            return None
        row.revoked_at = timezone.now()
        row.save(update_fields=["revoked_at"])
        return row


def purge_after(revoked_at: dt.datetime) -> dt.datetime:
    return revoked_at + dt.timedelta(hours=settings.CONSENT_REVOCATION_GRACE_HOURS)
