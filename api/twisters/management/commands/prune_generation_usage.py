from django.core.management.base import BaseCommand
from django.utils import timezone

from twisters.generate import quota


class Command(BaseCommand):
    help = (
        "Daily: delete Generate Twister usage rows (the per-day quota ledger) older than "
        "GENERATE_USAGE_RETENTION_DAYS (90). Only today's row affects the quota. Safe to re-run."
    )

    def handle(self, **_):
        self.stdout.write(self.style.SUCCESS(f"pruned={quota.prune(timezone.now())}"))
