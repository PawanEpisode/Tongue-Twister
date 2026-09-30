from django.core.management.base import BaseCommand

from twisters.media import recordings, reminders


class Command(BaseCommand):
    help = (
        "Hourly media retention: soft-delete recordings past expires_at, honour revoked consents after "
        "the grace period, hard-delete anything soft-deleted longer than the restore window (objects, "
        "quota ledger), purge expired voice clips and e-mail T-3 day expiry reminders. Safe to re-run."
    )

    def handle(self, **_):
        steps = (
            ("expired", recordings.expire_due),
            ("consent_revoked", recordings.enforce_consent_revocations),
            ("hard_deleted", recordings.hard_delete_due),
            ("voice_expired", recordings.purge_expired_assets),
            ("reminded", reminders.remind_expiring),
        )
        counts = {name: step() for name, step in steps}
        self.stdout.write(
            self.style.SUCCESS(", ".join(f"{name}={value}" for name, value in counts.items()))
        )
