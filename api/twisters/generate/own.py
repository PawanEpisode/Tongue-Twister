"""A person's own generated twisters: the list behind `/me/twisters/` and deleting one."""

from __future__ import annotations

from django.db import transaction
from django.db.models import QuerySet
from rest_framework.exceptions import NotFound

from .. import errors
from ..models import Profile, Recording, RecordingStatus, Twister, TwisterVisibility


def owned(profile: Profile) -> QuerySet[Twister]:
    """Newest first. Filters on ownership *and* privacy, so it can never reach a public twister."""
    return Twister.objects.filter(owner=profile, visibility=TwisterVisibility.PRIVATE).order_by(
        "-created_at", "-id"
    )


def delete(profile: Profile, twister_id: int) -> None:
    """Remove one of the caller's twisters with its attempts, stats and favourites (cascade). Someone
    else's id is a 404, never a hint that it exists. A twister that still has a recording is refused:
    deleting it would orphan the stored media, so the recording has to go first."""
    with transaction.atomic():
        twister = owned(profile).select_for_update().filter(pk=twister_id).first()
        if twister is None:
            raise NotFound("No such twister.")
        has_media = (
            Recording.objects.filter(twister=twister)
            .exclude(status=RecordingStatus.DELETED)
            .exists()
        )
        if has_media:
            raise errors.Conflict("Delete this twister's recordings first.")
        twister.delete()
