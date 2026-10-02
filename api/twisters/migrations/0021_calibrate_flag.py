from django.db import migrations


def seed(apps, schema_editor):
    Flag = apps.get_model("twisters", "FeatureFlag")
    # Off by default and never re-disabled: staff turn it on (allow-list their own profile) to record gold clips at /dev/calibrate.
    Flag.objects.get_or_create(
        code="calibrate",
        defaults={"description": "Gold-set recording and benchmark tools (/dev/calibrate)", "enabled": False},
    )


def unseed(apps, schema_editor):
    apps.get_model("twisters", "FeatureFlag").objects.filter(code="calibrate").delete()


class Migration(migrations.Migration):
    dependencies = [("twisters", "0020_scoring_job_queue")]
    operations = [migrations.RunPython(seed, unseed)]
