import datetime as dt

from django.core.management.base import BaseCommand
from django.utils import timezone

from twisters.models import Attempt, PublicStatSnapshot
from twisters.public import stats


class Command(BaseCommand):
    help = "Recompute the usage numbers shown on the public site (30-day practisers and attempts)."

    def handle(self, **_):
        now = timezone.now()
        since = now - dt.timedelta(days=30)
        recent = Attempt.objects.filter(created_at__gte=since, profile__deletion_requested_at=None)
        values = {
            stats.PRACTISERS: recent.values("profile_id").distinct().count(),
            stats.ATTEMPTS: recent.count(),
        }
        for key, value in values.items():
            PublicStatSnapshot.objects.update_or_create(
                key=key, defaults={"value": value, "computed_at": now}
            )
        self.stdout.write(self.style.SUCCESS(f"Public stats refreshed: {values}"))
