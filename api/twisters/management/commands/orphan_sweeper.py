from django.core.management.base import BaseCommand

from twisters.media import jobs, processing, recordings


class Command(BaseCommand):
    help = (
        "Daily: uploads that never completed within MEDIA_ORPHAN_HOURS lose their reservation and "
        "their stored object, and their recording is marked failed. Also the media-job sweep: jobs "
        "whose worker lease lapsed are re-queued (or failed after MEDIA_JOB_MAX_TRIES), jobs for "
        "deleted recordings are cancelled, and originals replaced by a transcode are removed. "
        "Safe to re-run."
    )

    def handle(self, **_):
        swept = jobs.sweep()
        self.stdout.write(
            self.style.SUCCESS(
                f"Swept {recordings.sweep_orphans()} abandoned uploads; jobs: "
                f"requeued={swept.requeued}, failed={swept.failed}, cancelled={swept.cancelled}; "
                f"replaced originals removed={processing.purge_replaced_sources()}."
            )
        )
