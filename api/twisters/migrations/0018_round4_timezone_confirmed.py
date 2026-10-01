from django.db import migrations, models
from django.db.models import Q


def confirm_existing(apps, schema_editor):
    """Until now 'confirmed' meant 'not the UTC placeholder'; keep that for the rows that exist."""
    apps.get_model("twisters", "Profile").objects.filter(~Q(timezone="UTC")).update(
        timezone_confirmed=True
    )


class Migration(migrations.Migration):
    dependencies = [
        ("twisters", "0017_round2_reminders_schema"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="timezone_confirmed",
            field=models.BooleanField(
                default=False,
                help_text="True once the person (or their browser) has set `timezone`: until then 'UTC' is a placeholder, and clock-based rules (reminders, hour badges) must not trust it",
            ),
        ),
        migrations.RunPython(confirm_existing, migrations.RunPython.noop),
    ]
