"""Account deletion with a grace period (decision D21).

Requesting deletion makes the account *pending*: share links are revoked at once (so public pages
answer 410), the profile leaves the boards and reminders stop (both through `active_profile_q`), and
`account.pending` blocks every write except asking again and cancelling. Nothing is destroyed until
the grace period is over. Cancelling restores the account exactly as it was, except that links revoked
on request stay revoked (the owner makes new ones).

`purge_due` is what the hourly `purge_deleted_accounts` job runs. Per profile, in one transaction:
every stored object goes first (the shared media purge), then the Profile row (everything else cascades
from it), then the Supabase Auth user. A failure anywhere leaves the account pending and the next run
retries; each step is idempotent, so a half-finished earlier run does no harm.
"""

from __future__ import annotations

import datetime as dt
import logging
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ..media import recordings, shares
from ..models import Profile
from .authadmin import AuthAdminError, AuthAdminPort, get_auth_admin

log = logging.getLogger(__name__)


PURGED, DEFERRED, SKIPPED = "purged", "deferred", "skipped"


@dataclass(frozen=True)
class PurgeReport:
    purged: int = 0
    deferred: int = 0  # due, but storage or Supabase refused: still pending, retried next run
    skipped: int = 0  # no longer due or pending (cancelled while the job was running)


def grace_period() -> dt.timedelta:
    return dt.timedelta(days=settings.ACCOUNT_DELETION_GRACE_DAYS)


def request_deletion(profile: Profile, now: dt.datetime | None = None) -> Profile:
    """Start (or, if already pending, re-report) the deletion. Idempotent: the dates never move."""
    now = now or timezone.now()
    with transaction.atomic():
        locked = Profile.objects.select_for_update().get(pk=profile.pk)
        if not locked.pending_deletion:
            locked.deletion_requested_at = now
            locked.deletion_scheduled_for = now + grace_period()
            locked.save(update_fields=["deletion_requested_at", "deletion_scheduled_for"])
            shares.revoke_for_creator(locked)
    profile.deletion_requested_at = locked.deletion_requested_at
    profile.deletion_scheduled_for = locked.deletion_scheduled_for
    return profile


def cancel_deletion(profile: Profile) -> Profile:
    """Back to a normal account. Allowed until the purge actually runs, even past the scheduled date."""
    with transaction.atomic():
        locked = Profile.objects.select_for_update().get(pk=profile.pk)
        locked.deletion_requested_at = locked.deletion_scheduled_for = None
        locked.save(update_fields=["deletion_requested_at", "deletion_scheduled_for"])
    profile.deletion_requested_at = profile.deletion_scheduled_for = None
    return profile


def _purge_one(profile_id, now: dt.datetime, auth_admin: AuthAdminPort) -> str:
    """Purge one account; returns PURGED, DEFERRED or SKIPPED. Re-checks under the row lock, so a
    cancel that raced the job wins."""
    with transaction.atomic():
        locked = (
            Profile.objects.pending_deletion()
            .select_for_update()
            .filter(pk=profile_id, deletion_scheduled_for__lte=now)
            .first()
        )
        if locked is None:
            return SKIPPED
        if not recordings.purge_all_media(locked):
            log.warning("account.purge_deferred profile=%s reason=storage", profile_id)
            return DEFERRED
        locked.delete()
        auth_admin.delete_user(profile_id)  # raising here rolls the delete back: still pending
    return PURGED


def purge_due(
    now: dt.datetime | None = None, auth_admin: AuthAdminPort | None = None
) -> PurgeReport:
    now = now or timezone.now()
    auth_admin = auth_admin or get_auth_admin()
    due = (
        Profile.objects.pending_deletion()
        .filter(deletion_scheduled_for__lte=now)
        .values_list("pk", flat=True)
    )
    outcomes: list[str] = []
    for profile_id in list(due):
        try:
            outcomes.append(_purge_one(profile_id, now, auth_admin))
        except AuthAdminError:
            log.warning("account.purge_deferred profile=%s reason=auth_admin", profile_id)
            outcomes.append(DEFERRED)
        except Exception:  # one bad account must not stop the others
            log.exception("account.purge_failed profile=%s", profile_id)
            outcomes.append(DEFERRED)
    return PurgeReport(
        purged=outcomes.count(PURGED),
        deferred=outcomes.count(DEFERRED),
        skipped=outcomes.count(SKIPPED),
    )
