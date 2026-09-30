"""`Attempt.voice_asset_id` and `ScoringJob.audio_asset_id` become real foreign keys to MediaAsset.

The column names do not change (`db_column` keeps `voice_asset_id` / `audio_asset_id`), so the ORM
attribute `attempt.voice_asset_id` still reads and writes the raw id. Rename-then-alter keeps the data
in place; Django's plain "remove + add" would drop it. Values were made valid by 0008.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("twisters", "0008_legacy_asset_tombstones"),
    ]

    operations = [
        migrations.RenameField("attempt", "voice_asset_id", "voice_asset"),
        migrations.AlterField(
            model_name="attempt",
            name="voice_asset",
            field=models.ForeignKey(
                blank=True,
                db_column="voice_asset_id",
                help_text="Opt-in cloud copy of the audio (kind=audio); the id stays `voice_asset_id` in code and column",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="voiced_attempts",
                to="twisters.mediaasset",
            ),
        ),
        migrations.RenameField("scoringjob", "audio_asset_id", "audio_asset"),
        migrations.AlterField(
            model_name="scoringjob",
            name="audio_asset",
            field=models.ForeignKey(
                blank=True,
                db_column="audio_asset_id",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="scoring_jobs",
                to="twisters.mediaasset",
            ),
        ),
    ]
