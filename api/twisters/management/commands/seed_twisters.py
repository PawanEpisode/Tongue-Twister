import json
from pathlib import Path

from django.core.management.base import BaseCommand
from django.db import transaction

from twisters.models import Category, Twister, TwisterPronunciation


class Command(BaseCommand):
    help = "Idempotently load categories and tongue twisters from twisters/data/twisters.json (upsert by slug)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--prune",
            action="store_true",
            help="Unpublish twisters whose slug is NOT in the seed file (keeps attempts/favourites; nothing is deleted)",
        )

    @transaction.atomic
    def handle(self, prune=False, **_):
        data = json.loads(
            (Path(__file__).resolve().parents[2] / "data" / "twisters.json").read_text(
                encoding="utf-8"
            )
        )
        cats = {}
        for c in data["categories"]:
            cats[c["slug"]], _ = Category.objects.update_or_create(
                slug=c["slug"], defaults={k: v for k, v in c.items() if k != "slug"}
            )
        slugs = []
        for t in data["twisters"]:
            t = dict(t)
            slug = t.pop("slug")
            t["category"] = cats[t["category"]]
            Twister.objects.update_or_create(slug=slug, defaults=t)  # .save() recomputes word_count
            slugs.append(slug)
        overrides = self._seed_overrides()
        msg = f"Seeded {len(cats)} categories, {len(slugs)} twisters, {overrides} pronunciation overrides"
        if prune:
            n = (
                Twister.objects.exclude(slug__in=slugs)
                .filter(is_published=True)
                .update(is_published=False)
            )
            msg += f"; unpublished {n} not in seed file"
        self.stdout.write(self.style.SUCCESS(msg))

    @staticmethod
    def _seed_overrides() -> int:
        """Global lexicon overrides kept in the repo; rows added later in the admin are left alone."""
        rows = json.loads(
            (
                Path(__file__).resolve().parents[2]
                / "speak"
                / "data"
                / "pronunciation_overrides.json"
            ).read_text(encoding="utf-8")
        )["words"]
        for row in rows:
            TwisterPronunciation.objects.update_or_create(
                twister=None,
                word=row["word"],
                accent="",
                defaults={
                    "arpabet": " | ".join(row["arpabet"]),
                    "respelling": row.get("respelling", ""),
                    "accepted_variants": row.get("accepted_variants", []),
                    "note": row.get("note", ""),
                    "source": TwisterPronunciation.Source.OVERRIDE,
                },
            )
        return len(rows)
