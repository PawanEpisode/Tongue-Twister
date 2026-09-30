from django.db import migrations


def set_flag(enabled: bool):
    def apply(apps, schema_editor):
        apps.get_model("twisters", "FeatureFlag").objects.filter(code="speak_v2").update(enabled=enabled)

    return apply


class Migration(migrations.Migration):
    """Speak & score v2 (word-level results, scoring v2, offline sync) ships with ERD 06b; the flag stays
    a kill switch."""

    dependencies = [
        ("twisters", "0005_speak_score_v2"),
    ]

    operations = [migrations.RunPython(set_flag(True), set_flag(False))]
