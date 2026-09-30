from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from twisters.models import Twister, TwisterPronunciation
from twisters.speak import lexicon
from twisters.speak.normalise import tokenise

VARIANT_SEPARATOR = " | "


def _override_index(twister: Twister) -> dict[str, list[str]]:
    """word -> variants from overrides (this twister's rows beat global ones; accent-specific rows are
    for the scorer, not for the shared lexicon)."""
    rows = TwisterPronunciation.objects.filter(
        Q(twister=twister) | Q(twister__isnull=True), accent=""
    ).exclude(arpabet="")
    index: dict[str, list[str]] = {}
    for row in sorted(
        rows, key=lambda r: r.twister_id is not None
    ):  # global first, twister overrides
        index[row.word] = [v.strip() for v in row.arpabet.split(VARIANT_SEPARATOR) if v.strip()]
    return index


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
            for twister in Twister.objects.filter(is_published=True):
                overrides = _override_index(twister)
                phonemes: dict[str, list[str]] = {}
                for word in dict.fromkeys(tokenise(twister.text)):
                    variants = overrides.get(word) or [
                        lexicon.format_variant(v) for v in lexicon.lookup(word)
                    ]
                    if variants:
                        phonemes[word] = variants
                    else:
                        missing.setdefault(twister.slug, []).append(word)
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
