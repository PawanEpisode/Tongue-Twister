from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from twisters.models import Twister, TwisterVisibility
from twisters.speak import pronunciations


class Command(BaseCommand):
    help = (
        "Resolve an ARPAbet pronunciation for every word of every published twister (overrides, then "
        "CMUdict + suffix/compound rules) and store it in Twister.phonemes. Exits non-zero when a "
        "word has none: a twister must not be published with an unknown word."
    )

    def add_arguments(self, parser):
        parser.add_argument("--check", action="store_true", help="Only verify; write nothing (CI)")

    def handle(self, check=False, **_):
        missing: dict[str, list[str]] = {}
        changed = 0
        with transaction.atomic():
            # Private twisters (D25) are unpublished but need their pronunciations kept current too.
            for twister in Twister.objects.filter(
                Q(is_published=True) | Q(visibility=TwisterVisibility.PRIVATE)
            ):
                phonemes, unknown = pronunciations.resolve(
                    twister.text, pronunciations.override_index(twister.pk)
                )
                if unknown and twister.is_published:
                    missing[twister.slug] = unknown
                elif (
                    unknown
                ):  # a private twister (D25) is user content: never fails the catalogue check
                    continue
                if not check and phonemes != twister.phonemes:
                    twister.phonemes = phonemes
                    twister.phoneme_version += 1
                    twister.save(update_fields=["phonemes", "phoneme_version"])
                    changed += 1
        if missing:
            lines = [f"  {slug}: {', '.join(words)}" for slug, words in sorted(missing.items())]
            raise CommandError(
                "Words without a pronunciation (add them to speak/data/pronunciation_overrides.json "
                "or the admin):\n" + "\n".join(lines)
            )
        self.stdout.write(
            self.style.SUCCESS("All words have a pronunciation.")
            if check
            else self.style.SUCCESS(f"Updated {changed} twisters.")
        )
