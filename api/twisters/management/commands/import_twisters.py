"""Bulk-import tongue twisters from CSV or JSON.

CSV columns (header row required):
  text            required  the twister itself
  difficulty      required  1-4 or easy|medium|hard|insane
  category        optional  category slug (created if --create-categories is given)
  origin          optional  classic | modern   (default classic)
  tip             optional  coaching hint (<=240 chars)
  focus_sounds    optional  pipe-separated, e.g. s|sh|th
  slug            optional  unique; auto-generated from text when blank
  is_published    optional  true/false (default true)

Examples:
  python manage.py import_twisters my_list.csv --dry-run
  python manage.py import_twisters my_list.csv --create-categories
  python manage.py import_twisters my_list.json --update   # overwrite rows whose slug already exists
"""
import csv
import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.text import slugify

from twisters.models import Category, Twister

DIFFICULTY = {"easy": 1, "medium": 2, "hard": 3, "insane": 4, "1": 1, "2": 2, "3": 3, "4": 4}
TRUTHY = {"", "1", "true", "yes", "y", "t"}


def norm_row(raw: dict) -> dict:
    row = {(k or "").strip().lower(): (v if isinstance(v, (list, bool)) else str(v or "").strip()) for k, v in raw.items()}
    text = " ".join(str(row.get("text", "")).split())
    if not text:
        raise ValueError("text is required")
    diff = DIFFICULTY.get(str(row.get("difficulty", "")).lower())
    if not diff:
        raise ValueError(f"difficulty must be 1-4 or easy/medium/hard/insane (got {row.get('difficulty')!r})")
    origin = (str(row.get("origin", "")) or "classic").lower()
    if origin not in ("classic", "modern"):
        raise ValueError("origin must be classic or modern")
    sounds = row.get("focus_sounds", "")
    if isinstance(sounds, str):
        sounds = [s.strip().lower() for s in sounds.replace(",", "|").split("|") if s.strip()]
    pub = row.get("is_published", "")
    published = pub if isinstance(pub, bool) else str(pub).lower() in TRUTHY
    tip = str(row.get("tip", ""))
    if len(tip) > 240:
        raise ValueError("tip is longer than 240 chars")
    slug = slugify(str(row.get("slug", "")) or " ".join(text.split()[:8]))[:80]
    if not slug:
        raise ValueError("could not derive a slug")
    return dict(slug=slug, text=text, difficulty=diff, origin=origin, tip=tip, focus_sounds=sounds,
                is_published=published, category=str(row.get("category", "")).lower())


class Command(BaseCommand):
    help = "Import tongue twisters from a CSV or JSON file (see module docstring for columns)."

    def add_arguments(self, parser):
        parser.add_argument("path")
        parser.add_argument("--dry-run", action="store_true", help="validate only; write nothing")
        parser.add_argument("--update", action="store_true", help="overwrite twisters whose slug already exists")
        parser.add_argument("--create-categories", action="store_true", help="create unknown category slugs")

    def handle(self, path, dry_run, update, create_categories, **_):
        p = Path(path)
        if not p.exists():
            raise CommandError(f"{p} not found")
        if p.suffix.lower() == ".json":
            data = json.loads(p.read_text(encoding="utf-8"))
            raw_rows = data["twisters"] if isinstance(data, dict) else data
        else:
            with p.open(newline="", encoding="utf-8-sig") as f:
                raw_rows = list(csv.DictReader(f))

        rows, errors, seen = [], [], set()
        for i, raw in enumerate(raw_rows, start=2 if p.suffix.lower() != ".json" else 1):
            try:
                r = norm_row(raw)
                if r["slug"] in seen:
                    raise ValueError(f"duplicate slug in file: {r['slug']}")
                seen.add(r["slug"])
                rows.append(r)
            except ValueError as exc:
                errors.append(f"row {i}: {exc}")
        if errors:
            raise CommandError("Validation failed:\n  " + "\n  ".join(errors[:50]) + (f"\n  …and {len(errors) - 50} more" if len(errors) > 50 else ""))

        created = updated = skipped = 0
        with transaction.atomic():
            cats = {c.slug: c for c in Category.objects.all()}
            for r in rows:
                cat_slug = r.pop("category")
                cat = None
                if cat_slug:
                    cat = cats.get(cat_slug)
                    if cat is None:
                        if not create_categories:
                            raise CommandError(f"unknown category {cat_slug!r} (use --create-categories or fix the file)")
                        cat = cats[cat_slug] = Category.objects.create(slug=cat_slug, name=cat_slug.replace("-", " ").title())
                slug = r.pop("slug")
                existing = Twister.objects.filter(slug=slug).first()
                if existing and not update:
                    skipped += 1
                    continue
                if existing:
                    for k, v in r.items():
                        setattr(existing, k, v)
                    existing.category = cat
                    existing.save()
                    updated += 1
                else:
                    Twister.objects.create(slug=slug, category=cat, **r)
                    created += 1
            if dry_run:
                transaction.set_rollback(True)
        prefix = "[dry run] " if dry_run else ""
        self.stdout.write(self.style.SUCCESS(f"{prefix}created {created}, updated {updated}, skipped {skipped} existing (of {len(rows)} valid rows)"))
