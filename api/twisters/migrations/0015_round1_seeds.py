"""Seed Round 1 (spec 15): the `score_cards` flag (on) and the two clock-based achievements.

Data only; the schema is `0014` (same split as 0012/0013). The two catalogue rows are a *frozen copy* of
`twisters/progress/catalogue.py` as of this commit (migrations must not import live code or settings);
later edits go through `manage.py sync_achievements`. Idempotent forwards; reverse removes exactly what
was seeded, including any unlocks of those two badges.
"""

from django.db import migrations

ACHIEVEMENTS = [
    {
        "code": "night_owl",
        "name": "Night Owl",
        "description": "Finish a scored attempt between 11 p.m. and 3 a.m.",
        "icon": "moon",
        "tier": "bronze",
        "category": "skill",
        "criteria": {"type": "attempt_local_hour", "from": 23, "to": 3, "kinds": ["test", "record"]},
        "xp_reward": 20,
        "verified_only": False,
        "hidden": False,
        "sort_order": 260,
    },
    {
        "code": "early_bird",
        "name": "Early Bird",
        "description": "Finish a scored attempt between 5 and 8 a.m.",
        "icon": "sunrise",
        "tier": "bronze",
        "category": "skill",
        "criteria": {"type": "attempt_local_hour", "from": 5, "to": 8, "kinds": ["test", "record"]},
        "xp_reward": 20,
        "verified_only": False,
        "hidden": False,
        "sort_order": 270,
    },
]

# Score cards store no media, so unlike `share_links` they do not wait for Supabase Pro (D20).
FLAGS = {"score_cards": (True, "Shareable score cards and their public image")}


def forwards(apps, schema_editor):
    Achievement = apps.get_model("twisters", "Achievement")
    for row in ACHIEVEMENTS:
        defaults = {k: v for k, v in row.items() if k != "code"}
        Achievement.objects.update_or_create(
            code=row["code"], defaults={**defaults, "active": True}
        )
    FeatureFlag = apps.get_model("twisters", "FeatureFlag")
    for code, (enabled, description) in FLAGS.items():
        FeatureFlag.objects.update_or_create(
            code=code, defaults={"enabled": enabled, "description": description}
        )


def backwards(apps, schema_editor):
    codes = [row["code"] for row in ACHIEVEMENTS]
    apps.get_model("twisters", "UserAchievement").objects.filter(achievement_id__in=codes).delete()
    apps.get_model("twisters", "Achievement").objects.filter(code__in=codes).delete()
    apps.get_model("twisters", "FeatureFlag").objects.filter(code__in=list(FLAGS)).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("twisters", "0014_account_night_owl_schema"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
