from django.db import migrations

# The curated signed-out teaser (PRD-public-site section 9.1): first three twisters of each level, with two
# swaps so all six sound families appear. A database seeded from `twisters.json` already has these positions;
# this sets them on one that was seeded earlier. Slugs that do not exist are skipped.
TEASER = [
    "sam-sam-sheep",
    "fat-frogs",
    "big-black-bug",
    "she-sells-seashells",
    "snake-slithers",
    "unique-new-york",
    "cooks-cook",
    "red-lorry-yellow-lorry",
    "truly-rural",
    "six-sick-sheiks",
    "pad-kid-poured",
    "irish-wristwatch",
]

FLAGS = [
    (
        "public_site",
        "Public site: marketing landing, curated teaser and sign-in gate for signed-out visitors. Off restores guest-first behaviour.",
        True,
    ),
    ("landing_demo", "The no-account demo card on the landing page.", True),
    ("newsletter", "Footer newsletter sign-up (not built yet).", False),
]


def seed(apps, schema_editor):
    FeatureFlag = apps.get_model("twisters", "FeatureFlag")
    for code, description, enabled in FLAGS:
        FeatureFlag.objects.get_or_create(
            code=code,
            defaults={"description": description[:200], "enabled": enabled, "rollout_pct": 100},
        )
    Twister = apps.get_model("twisters", "Twister")
    for position, slug in enumerate(TEASER, start=1):
        Twister.objects.filter(
            slug=slug, visibility="public", is_published=True, owner__isnull=True
        ).update(teaser_position=position)


class Migration(migrations.Migration):
    dependencies = [
        ("twisters", "0027_public_site"),
    ]

    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
