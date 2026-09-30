import datetime as dt

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from twisters.models import Attempt, Profile, ScoringJob, Verification
from twisters.speak import stats

MAX_JOBS = 2  # the first dispatch plus one retry (ERD 06b "Pending retry")


class Command(BaseCommand):
    help = (
        "Attempts stuck in `pending` longer than PENDING_RETRY_AFTER_MIN get one more spot-check job; "
        "after that they become `failed` and the device result stands."
    )

    def handle(self, **_):
        cutoff = timezone.now() - dt.timedelta(minutes=settings.PENDING_RETRY_AFTER_MIN)
        retried = gave_up = 0
        pending = Attempt.objects.filter(
            verification_status=Verification.PENDING, created_at__lt=cutoff
        ).select_related("model_version")
        for attempt in pending.iterator():
            with transaction.atomic():
                jobs = list(attempt.scoring_jobs.select_for_update().order_by("created_at"))
                open_jobs = [
                    j
                    for j in jobs
                    if j.status in (ScoringJob.Status.QUEUED, ScoringJob.Status.RUNNING)
                ]
                if any(j.created_at >= cutoff for j in jobs):
                    continue  # a job is still inside its window
                for job in open_jobs:
                    job.status = ScoringJob.Status.EXPIRED
                    job.finished_at = timezone.now()
                    job.save(update_fields=["status", "finished_at"])
                model = jobs[-1].model_version if jobs else attempt.model_version
                if len(jobs) < MAX_JOBS and model is not None:
                    ScoringJob.objects.create(
                        attempt=attempt,
                        kind=ScoringJob.Kind.SPOT_CHECK,
                        model_version=model,
                        audio_asset_id=jobs[-1].audio_asset_id if jobs else None,
                        tries=len(jobs),
                    )
                    retried += 1
                else:
                    attempt.verification_status = Verification.FAILED
                    attempt.save(update_fields=["verification_status"])
                    stats.rebuild_twister_stats(
                        Profile.objects.select_for_update().get(pk=attempt.profile_id),
                        attempt.twister,
                    )
                    gave_up += 1
        self.stdout.write(self.style.SUCCESS(f"Retried {retried}, gave up on {gave_up}."))
