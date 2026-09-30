from django.core.management.base import BaseCommand
from django.db import transaction

from twisters.models import Profile
from twisters.speak import stats


class Command(BaseCommand):
    help = (
        "Rebuild UserWordStat, UserPhonemeStat and UserTwisterStats from attempts (nightly job; "
        "also fixes drift after out-of-order syncs, deletions or trust changes)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--profile", help="Only this profile id")

    def handle(self, profile=None, **_):
        profiles = Profile.objects.filter(attempts__isnull=False).distinct()
        if profile:
            profiles = profiles.filter(pk=profile)
        count = 0
        for p in profiles.iterator():
            with transaction.atomic():
                locked = Profile.objects.select_for_update().get(pk=p.pk)
                stats.rebuild_profile_stats(locked)
            count += 1
        self.stdout.write(self.style.SUCCESS(f"Reconciled {count} profiles."))
