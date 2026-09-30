"""Reports on shared links and the auto-hide rule (decision D2, PRD 04 V14).

One report per (link, reporter) is enforced by the database: signed-in users are keyed by profile,
anonymous viewers by a salted IP hash. When `REPORT_AUTOHIDE_THRESHOLD` distinct reporters have an
un-dismissed report, the link is put on hold (`hidden_at`, resolves as 410) until staff decide.
"""

from __future__ import annotations

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from ..models import (
    ModerationReport,
    Profile,
    Recording,
    ReportStatus,
    ShareLink,
    ShareTarget,
)
from . import shares


def report(
    link: ShareLink, *, reporter: Profile | None, ip_hash: str, reason: str, details: str
) -> tuple[ModerationReport, bool]:
    """File a report. Returns (report, created); a repeat from the same reporter is a no-op."""
    lookup = {"reporter": reporter} if reporter else {"reporter": None, "reporter_ip_hash": ip_hash}
    try:
        with transaction.atomic():
            existing = ModerationReport.objects.filter(share_link=link, **lookup).first()
            if existing:
                return existing, False
            row = ModerationReport.objects.create(
                share_link=link,
                reporter=reporter,
                reporter_ip_hash="" if reporter else ip_hash,
                reason=reason,
                details=details,
            )
    except IntegrityError:  # a concurrent identical report won the unique index
        return ModerationReport.objects.get(share_link=link, **lookup), False
    auto_hide_if_needed(link)
    return row, True


def distinct_reporters(link: ShareLink) -> int:
    return link.reports.exclude(status=ReportStatus.DISMISSED).count()


def auto_hide_if_needed(link: ShareLink) -> bool:
    if link.hidden_at is None and distinct_reporters(link) >= settings.REPORT_AUTOHIDE_THRESHOLD:
        ShareLink.objects.filter(pk=link.pk, hidden_at__isnull=True).update(
            hidden_at=timezone.now()
        )
        return True
    return False


def dismiss(report_row: ModerationReport, staff: str) -> None:
    """Staff: the report was wrong. The link comes back if it is no longer over the threshold."""
    _resolve(report_row, ReportStatus.DISMISSED, staff)
    link = report_row.share_link
    if link.hidden_at and distinct_reporters(link) < settings.REPORT_AUTOHIDE_THRESHOLD:
        ShareLink.objects.filter(pk=link.pk).update(hidden_at=None)


def action(report_row: ModerationReport, staff: str) -> None:
    """Staff: the report is valid. Hold every link to the target and hide the recording itself."""
    _resolve(report_row, ReportStatus.ACTIONED, staff)
    link = report_row.share_link
    shares.hold_for_target(link.target_type, link.target_id)
    if link.target_type == ShareTarget.RECORDING:
        Recording.objects.filter(pk=link.target_id, hidden_at__isnull=True).update(
            hidden_at=timezone.now()
        )


def _resolve(report_row: ModerationReport, status: str, staff: str) -> None:
    report_row.status = status
    report_row.resolved_by = staff[:150]
    report_row.resolved_at = timezone.now()
    report_row.save(update_fields=["status", "resolved_by", "resolved_at"])
