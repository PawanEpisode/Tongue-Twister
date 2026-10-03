from django.core.management.base import BaseCommand
from django.db.models import Q

from twisters.models import (
    ProfileEvent,
    ProfileEventKind,
    UserAchievement,
    UserTwisterStats,
)

BATCH = 500


def _achievement_events():
    unlocks = UserAchievement.objects.filter(revoked=False).select_related("achievement")
    for row in unlocks.iterator(chunk_size=BATCH):
        badge = row.achievement
        yield ProfileEvent(
            profile_id=row.profile_id,
            kind=ProfileEventKind.ACHIEVEMENT,
            ref=f"ach:{badge.code}",
            data={"code": badge.code, "name": badge.name, "tier": badge.tier, "icon": badge.icon},
            created_at=row.unlocked_at,
        )


def _mastered_events():
    mastered = UserTwisterStats.objects.filter(~Q(mastered_at=None)).select_related("twister")
    for row in mastered.iterator(chunk_size=BATCH):
        yield ProfileEvent(
            profile_id=row.profile_id,
            kind=ProfileEventKind.TWISTER_MASTERED,
            ref=f"mastered:{row.twister.slug}",
            data={"twister": row.twister.slug},
            created_at=row.mastered_at,
        )


class Command(BaseCommand):
    help = (
        "One-off: give existing accounts a starting timeline from badges they already hold and "
        "twisters they already mastered. Idempotent (events have natural keys), safe to re-run."
    )

    def handle(self, **_):
        total = 0
        for events in (_achievement_events(), _mastered_events()):
            batch = []
            for event in events:
                batch.append(event)
                if len(batch) >= BATCH:
                    ProfileEvent.objects.bulk_create(batch, ignore_conflicts=True)
                    total += len(batch)
                    batch = []
            if batch:
                ProfileEvent.objects.bulk_create(batch, ignore_conflicts=True)
                total += len(batch)
        self.stdout.write(self.style.SUCCESS(f"considered {total} moments"))
