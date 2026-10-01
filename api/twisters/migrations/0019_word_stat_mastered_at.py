from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("twisters", "0018_round4_timezone_confirmed"),
    ]

    operations = [
        migrations.AddField(
            model_name="userwordstat",
            name="mastered_at",
            field=models.DateTimeField(
                blank=True,
                null=True,
                help_text="Set by a confident drill pass; cleared by the next wrong or missed word. While set, the word is 'nailed' and leaves the weak-word queue.",
            ),
        ),
        migrations.AddIndex(
            model_name="userwordstat",
            index=models.Index(fields=["profile", "-mastered_at"], name="twisters_us_profile_be4cba_idx"),
        ),
    ]
