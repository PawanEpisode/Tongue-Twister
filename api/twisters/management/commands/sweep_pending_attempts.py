import datetime as dt

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from twisters.models import Attempt, Profile, ScoringJob, Verification
from twisters.speak import jobs, stats


class Command(BaseCommand):
    help = (
        "Scoring-queue housekeeping: lapsed leases are re-queued or failed, jobs that can never run are expired, "
        "audio requests nobody answered are closed, and attempts left `pending` with no active job for "
        "PENDING_RETRY_AFTER_MIN become `failed` (the device result stands)."
    )

    def handle(self, **_):
        swept = jobs.sweep()
        cutoff = timezone.now() - dt.timedelta(minutes=settings.PENDING_RETRY_AFTER_MIN)
        gave_up = 0
        pending = Attempt.objects.filter(
            verification_status=Verification.PENDING, created_at__lt=cutoff
        )
        for attempt_id in list(pending.values_list("pk", flat=True)):
            with transaction.atomic():
                attempt = (
                    Attempt.objects.select_for_update(of=("self",))
                    .select_related("twister")
                    .get(pk=attempt_id)
                )
                if attempt.verification_status != Verification.PENDING:
                    continue
                if attempt.scoring_jobs.filter(status__in=ScoringJob.ACTIVE).exists():
                    continue  # a job is still queued or running: the lease sweep owns it
                attempt.verification_status = Verification.FAILED
                attempt.save(update_fields=["verification_status"])
                stats.rebuild_twister_stats(
                    Profile.objects.select_for_update().get(pk=attempt.profile_id),
                    attempt.twister,
                )
                gave_up += 1
        self.stdout.write(
            self.style.SUCCESS(
                f"Re-queued {swept.requeued}, failed {swept.failed}, expired {swept.expired}, "
                f"closed {swept.requests_closed} requests, gave up on {gave_up} attempts."
            )
        )
