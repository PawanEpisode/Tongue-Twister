from django.core.management.base import BaseCommand
from django.utils import timezone

from twisters.generate import quota
from twisters.media import quota as media_quota


class Command(BaseCommand):
    help = (
        "Daily housekeeping of small evidence tables: delete Generate Twister usage rows (the per-day quota "
        "ledger) older than GENERATE_USAGE_RETENTION_DAYS (90), and plan cap-hit rows older than "
        "QUOTA_HIT_RETENTION_DAYS (90). Only today's usage row affects the quota. Safe to re-run."
    )

    def handle(self, **_):
        now = timezone.now()
        self.stdout.write(
            self.style.SUCCESS(
                f"pruned={quota.prune(now)} quota_hits_pruned={media_quota.prune_hits(now)}"
            )
        )
