"""CI and ops check for the public site's curated content (docs/PRD-public-site.md, ERD section 6.4).

Fails (exit 1) when the signed-out teaser is broken: too few valid twisters, a curated twister that is not
public and published, a level or sound family with no representative, a stored curation that differs from
the rule, or a demo twister (read from --demo-slugs, a JSON list) that is missing, not public, or not in the
teaser."""

import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from twisters.models import Category, Twister
from twisters.public import teaser

MIN_VALID = 8


class Command(BaseCommand):
    help = "Verify the curated signed-out teaser and the demo twisters."

    def add_arguments(self, parser):
        parser.add_argument(
            "--demo-slugs",
            help="Path to a JSON list of the demo twister slugs (web/src/content/demo-slugs.json)",
        )

    def handle(self, demo_slugs=None, **_):
        problems: list[str] = []
        public = Twister.objects.public()

        bad = Twister.objects.filter(teaser_position__isnull=False).exclude(
            pk__in=public.values("pk")
        )
        for t in bad:
            problems.append(f"curated twister {t.slug} is not public and published")

        ids = teaser.teaser_ids()
        shown = list(public.filter(pk__in=ids).select_related("category"))
        if len(shown) < MIN_VALID:
            problems.append(f"only {len(shown)} valid teaser twisters (need at least {MIN_VALID})")
        levels = {t.difficulty for t in shown}
        for lvl in (1, 2, 3, 4):
            if lvl not in levels:
                problems.append(f"teaser has no level {lvl} twister")
        have = {t.category.slug for t in shown if t.category}
        for slug in (
            Category.objects.filter(twisters__in=public).distinct().values_list("slug", flat=True)
        ):
            if slug not in have:
                problems.append(f"teaser has no twister from sound family {slug}")

        rows = teaser._rows(public)
        expected = [r.id for r in teaser.choose(rows)][: settings.TEASER_SIZE]
        curated = list(
            public.filter(teaser_position__isnull=False)
            .order_by("teaser_position")
            .values_list("id", flat=True)
        )
        if curated and curated != expected:
            problems.append("stored teaser_position order differs from the selection rule")

        if demo_slugs:
            wanted = json.loads(Path(demo_slugs).read_text(encoding="utf-8"))
            in_teaser = {t.slug for t in shown}
            known = set(public.filter(slug__in=wanted).values_list("slug", flat=True))
            for slug in wanted:
                if slug not in known:
                    problems.append(f"demo twister {slug} is missing or not public")
                elif slug not in in_teaser:
                    problems.append(f"demo twister {slug} is not in the teaser")

        if problems:
            raise CommandError("Public site check failed:\n- " + "\n- ".join(problems))
        self.stdout.write(self.style.SUCCESS(f"Public site OK: {len(shown)} teaser twisters"))
