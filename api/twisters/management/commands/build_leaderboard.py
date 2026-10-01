from django.core.management.base import BaseCommand
from django.utils import timezone

from twisters.progress import boards


class Command(BaseCommand):
    help = (
        "Hourly: rebuild the weekly leaderboards of this and last week for every twister that was "
        "the daily twister that week (one transaction per board). Safe to re-run."
    )

    def handle(self, **_):
        counts = boards.rebuild_recent(timezone.now())
        self.stdout.write(
            self.style.SUCCESS(", ".join(f"{name}={value}" for name, value in counts.items()))
        )
