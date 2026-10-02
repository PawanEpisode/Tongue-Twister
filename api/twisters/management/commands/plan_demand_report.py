"""Evidence for "is a paid plan worth building?" (docs/features/13 section D, open question 2).

    python manage.py plan_demand_report [--days 60] [--json] [--min-users 30]

Reads only aggregates (counts and shares, never a user id) from data the product already keeps:

* **cap hits** - `QuotaHit` rows, one per user, limit and 10-minute window, written whenever a request is
  refused with HTTP 402 `quota_exceeded`;
* **active users** - people with at least one attempt or saved recording in the window (accounts pending
  deletion excluded, as everywhere else);
* **retention** - among active users whose first activity in the window is at least ``RETAIN_DAYS`` before it
  ends, the share still active in the last ``RETAIN_DAYS``. Reported for people who hit a cap and people who
  did not, so "do the capped users leave?" is a number rather than a feeling.

The report states its own sample size and refuses to call anything a signal below ``--min-users`` active
users, because a percentage of eleven people is not evidence. It decides nothing: it prints what was counted.
"""

from __future__ import annotations

import datetime as dt
import json as jsonlib

from django.core.management.base import BaseCommand
from django.db.models import Min
from django.utils import timezone

from twisters.models import Attempt, Profile, QuotaHit, Recording

RETAIN_DAYS = 14
LIMITS = ("recordings", "recording_ms", "storage_bytes")
LIMIT_LABEL = {
    "recordings": "recordings (count)",
    "recording_ms": "recording length (minutes)",
    "storage_bytes": "storage (bytes)",
}


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole, 4) if whole else None


def build(now: dt.datetime, days: int = 60, min_users: int = 30) -> dict:
    """The report as plain data (the command renders it; tests read it)."""
    start, retain_from = now - dt.timedelta(days=days), now - dt.timedelta(days=RETAIN_DAYS)
    live = Profile.objects.active()

    first_seen: dict = {}
    last_seen: dict = {}
    for model in (Attempt, Recording):
        rows = (
            model.objects.filter(created_at__gte=start, created_at__lte=now, profile__in=live)
            .values("profile_id")
            .annotate(first=Min("created_at"))
        )
        for row in rows:
            first_seen[row["profile_id"]] = min(
                first_seen.get(row["profile_id"], row["first"]), row["first"]
            )
    for model in (Attempt, Recording):
        for pid in (
            model.objects.filter(created_at__gte=retain_from, created_at__lte=now, profile__in=live)
            .values_list("profile_id", flat=True)
            .distinct()
        ):
            last_seen[pid] = True
    active = set(first_seen)
    cloud = set(
        Recording.objects.filter(created_at__gte=start, created_at__lte=now, profile__in=live)
        .values_list("profile_id", flat=True)
        .distinct()
    )

    hits = QuotaHit.objects.filter(created_at__gte=start, created_at__lte=now, profile__in=live)
    by_limit: dict[str, dict] = {}
    hit_users_any: set = set()
    for limit in LIMITS:
        rows = hits.filter(limit=limit)
        users = set(rows.values_list("profile_id", flat=True).distinct())
        hit_users_any |= users
        by_limit[limit] = {
            "label": LIMIT_LABEL[limit],
            "hits": rows.count(),
            "users": len(users),
            "share_of_active": _rate(len(users & active), len(active)),
            "share_of_cloud_users": _rate(len(users & cloud), len(cloud)),
        }
    other = hits.exclude(limit__in=LIMITS)
    if other.exists():
        by_limit["other"] = {
            "label": "other limits",
            "hits": other.count(),
            "users": other.values("profile_id").distinct().count(),
        }

    cohort = {pid for pid, seen in first_seen.items() if seen <= retain_from}
    capped, uncapped = cohort & hit_users_any, cohort - hit_users_any
    retained = lambda ids: sum(1 for pid in ids if pid in last_seen)  # noqa: E731
    enough = len(active) >= min_users
    return {
        "window_days": days,
        "generated_at": now.isoformat(timespec="seconds"),
        "active_users": len(active),
        "cloud_users": len(cloud & active),
        "users_hitting_any_cap": len(hit_users_any & active),
        "share_hitting_any_cap": _rate(len(hit_users_any & active), len(active)),
        "by_limit": by_limit,
        "retention": {
            "window_days": RETAIN_DAYS,
            "cohort": len(cohort),
            "capped": {
                "users": len(capped),
                "retained": retained(capped),
                "rate": _rate(retained(capped), len(capped)),
            },
            "not_capped": {
                "users": len(uncapped),
                "retained": retained(uncapped),
                "rate": _rate(retained(uncapped), len(uncapped)),
            },
        },
        "min_users": min_users,
        "enough_evidence": enough,
    }


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def render(report: dict) -> str:
    out = [
        f"Plan demand, last {report['window_days']} days",
        f"  active users: {report['active_users']}  (saved a take: {report['cloud_users']})",
        f"  hit any cap: {report['users_hitting_any_cap']}  ({_pct(report['share_hitting_any_cap'])} of active)",
        "",
        "Cap hits by limit",
    ]
    for row in report["by_limit"].values():
        out.append(
            f"  {row['label']:<28} {row['hits']:>5} hits  {row['users']:>4} users  "
            f"{_pct(row.get('share_of_active')):>6} of active  {_pct(row.get('share_of_cloud_users')):>6} of savers"
        )
    r = report["retention"]
    out += [
        "",
        f"Retention (active again in the last {r['window_days']} days; cohort = active at least that long ago, n={r['cohort']})",
        f"  hit a cap:  {r['capped']['retained']}/{r['capped']['users']}  ({_pct(r['capped']['rate'])})",
        f"  no cap hit: {r['not_capped']['retained']}/{r['not_capped']['users']}  ({_pct(r['not_capped']['rate'])})",
        "",
    ]
    if report["enough_evidence"]:
        out.append("Counts only: this report does not decide anything.")
    else:
        out.append(
            f"Not enough evidence yet: {report['active_users']} active users, need {report['min_users']}. "
            "Read the numbers as anecdotes."
        )
    return "\n".join(out)


class Command(BaseCommand):
    help = "Print cap-hit counts by limit, the share of active users hitting each, and retention with vs without a cap hit."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=60, help="Window length (default 60)")
        parser.add_argument(
            "--min-users",
            type=int,
            default=30,
            help="Active users needed before the numbers count as evidence",
        )
        parser.add_argument("--json", action="store_true", help="Machine-readable output")

    def handle(self, *, days, min_users, **options):
        report = build(timezone.now(), days=days, min_users=min_users)
        self.stdout.write(jsonlib.dumps(report, indent=2) if options["json"] else render(report))
