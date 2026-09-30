import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('twisters', '0003_guest_sync_flags_auto_wpm'),
    ]

    operations = [
        migrations.AddField(
            model_name='userpreference',
            name='metronome_volume',
            field=models.FloatField(default=0.5, validators=[django.core.validators.MinValueValidator(0.0), django.core.validators.MaxValueValidator(1.0)]),
        ),
        migrations.AddConstraint(
            model_name='userpreference',
            constraint=models.CheckConstraint(condition=models.Q(('metronome_volume__gte', 0.0), ('metronome_volume__lte', 1.0)), name='pref_metronome_volume_range'),
        ),
    ]
