import json
from pathlib import Path

from django.core.management.base import BaseCommand

from twisters.models import Category, Twister


class Command(BaseCommand):
    help = "Idempotently load seed categories and tongue twisters from data/twisters.json"

    def handle(self, *args, **opts):
        data = json.loads((Path(__file__).resolve().parents[2] / "data" / "twisters.json").read_text())
        cats = {}
        for c in data["categories"]:
            cats[c["slug"]], _ = Category.objects.update_or_create(slug=c["slug"], defaults={k: v for k, v in c.items() if k != "slug"})
        n = 0
        for t in data["twisters"]:
            t = dict(t)
            slug = t.pop("slug")
            t["category"] = cats[t["category"]]
            Twister.objects.update_or_create(slug=slug, defaults=t)
            n += 1
        self.stdout.write(self.style.SUCCESS(f"Seeded {len(cats)} categories, {n} twisters"))
