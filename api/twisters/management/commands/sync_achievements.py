from django.core.management.base import BaseCommand
from django.db import transaction

from twisters.progress.catalogue import upsert_catalogue


class Command(BaseCommand):
    help = (
        "Make the Achievement table match twisters/progress/catalogue.py: upsert every code and "
        "deactivate codes that are no longer listed. Never deletes a row, so unlocks survive. Safe to re-run."
    )

    def handle(self, **_):
        with transaction.atomic():
            counts = upsert_catalogue()
        self.stdout.write(
            self.style.SUCCESS(", ".join(f"{name}={value}" for name, value in counts.items()))
        )
