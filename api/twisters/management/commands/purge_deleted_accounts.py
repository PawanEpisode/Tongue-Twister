from django.core.management.base import BaseCommand

from twisters.account import deletion


class Command(BaseCommand):
    help = (
        "Hourly: permanently delete accounts whose deletion grace period (ACCOUNT_DELETION_GRACE_DAYS) "
        "is over. Per account: stored media objects first, then the profile and everything that "
        "cascades from it, then the Supabase Auth user. A storage or Supabase failure leaves the "
        "account pending and it is retried on the next run. Safe to re-run."
    )

    def handle(self, **_):
        report = deletion.purge_due()
        self.stdout.write(
            self.style.SUCCESS(
                f"purged={report.purged}, deferred={report.deferred}, skipped={report.skipped}"
            )
        )
