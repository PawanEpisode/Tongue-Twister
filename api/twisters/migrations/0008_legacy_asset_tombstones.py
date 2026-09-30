"""Give every pre-existing `voice_asset_id` / `audio_asset_id` value a real (tombstoned) MediaAsset row.

Until 06c those columns were bare UUIDs that nothing validated, so they may reference objects that
never existed. Turning them into foreign keys (0009) would fail on such values and nulling them would
lose data; a `deleted` tombstone keeps every id and satisfies the constraint. It lives in its own
migration because PostgreSQL refuses to ALTER a table that has pending trigger events from the inserts.
"""

import uuid

from django.db import migrations
from django.utils import timezone

LEGACY_SEGMENT = "legacy"


def _tombstone(MediaAsset, asset_id: uuid.UUID, profile_id) -> None:
    if MediaAsset.objects.filter(pk=asset_id).exists():
        return
    MediaAsset.objects.create(
        id=asset_id,
        profile_id=profile_id,
        kind="audio",
        bucket="voice",
        path=f"{profile_id}/{LEGACY_SEGMENT}/{asset_id}",
        mime_type="audio/webm",
        status="deleted",
        deleted_at=timezone.now(),
    )


def create_tombstones(apps, schema_editor):
    MediaAsset = apps.get_model("twisters", "MediaAsset")
    Attempt = apps.get_model("twisters", "Attempt")
    ScoringJob = apps.get_model("twisters", "ScoringJob")
    for asset_id, profile_id in (
        Attempt.objects.filter(voice_asset_id__isnull=False)
        .values_list("voice_asset_id", "profile_id")
        .iterator()
    ):
        _tombstone(MediaAsset, asset_id, profile_id)
    for asset_id, profile_id in (
        ScoringJob.objects.filter(audio_asset_id__isnull=False)
        .values_list("audio_asset_id", "attempt__profile_id")
        .iterator()
    ):
        _tombstone(MediaAsset, asset_id, profile_id)


def drop_tombstones(apps, schema_editor):
    apps.get_model("twisters", "MediaAsset").objects.filter(
        status="deleted", path__contains=f"/{LEGACY_SEGMENT}/"
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("twisters", "0007_record_media_sharing_consent"),
    ]

    operations = [migrations.RunPython(create_tombstones, drop_tombstones)]
