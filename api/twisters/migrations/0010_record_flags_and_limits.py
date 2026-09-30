"""Turn on local recording flags and add voice-clip limits to the free plan (spec 13 §0).

`record_cloud` and `share_links` stay off: they need Supabase Pro (decision D7). Frozen constants on
purpose: migrations must not import live settings.
"""

from django.db import migrations

ON = ("record_local", "record_screen", "record_region")
VOICE_LIMITS = {"voice_clip_ms_max": 60_000, "voice_clip_bytes_max": 2_097_152}


def forwards(apps, schema_editor):
    apps.get_model("twisters", "FeatureFlag").objects.filter(code__in=ON).update(enabled=True)
    Plan = apps.get_model("twisters", "Plan")
    for plan in Plan.objects.filter(code="free"):
        plan.limits = {**VOICE_LIMITS, **plan.limits}
        plan.save(update_fields=["limits"])


def backwards(apps, schema_editor):
    apps.get_model("twisters", "FeatureFlag").objects.filter(code__in=ON).update(enabled=False)
    Plan = apps.get_model("twisters", "Plan")
    for plan in Plan.objects.filter(code="free"):
        plan.limits = {k: v for k, v in plan.limits.items() if k not in VOICE_LIMITS}
        plan.save(update_fields=["limits"])


class Migration(migrations.Migration):
    dependencies = [
        ("twisters", "0009_asset_foreign_keys"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
