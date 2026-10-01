"""Resolving a twister's pronunciations (D10): overrides first, then the lexicon (CMUdict plus rules).

One definition shared by the `build_pronunciations` command (published twisters, offline) and the
generation service (a new private twister, at creation), so both agree on what "has a pronunciation"
means. A twister with an unresolvable word cannot be scored, so callers must reject or fail on `missing`.
"""

from django.db.models import Q

from ..models import TwisterPronunciation
from . import lexicon
from .normalise import tokenise

VARIANT_SEPARATOR = " | "


def override_index(twister_id: int | None = None) -> dict[str, list[str]]:
    """word -> variants from overrides (this twister's rows beat global ones; accent-specific rows are
    for the scorer, not for the shared lexicon). ``None`` = global overrides only (a twister not saved yet)."""
    scope = Q(twister__isnull=True) | Q(twister_id=twister_id) if twister_id else Q(twister=None)
    rows = TwisterPronunciation.objects.filter(scope, accent="").exclude(arpabet="")
    index: dict[str, list[str]] = {}
    for row in sorted(
        rows, key=lambda r: r.twister_id is not None
    ):  # global first, twister overrides
        index[row.word] = [v.strip() for v in row.arpabet.split(VARIANT_SEPARATOR) if v.strip()]
    return index


def resolve(
    text: str, overrides: dict[str, list[str]] | None = None
) -> tuple[dict[str, list[str]], list[str]]:
    """(word -> ARPAbet variants, words nothing resolves) for the distinct words of ``text``."""
    overrides = overrides or {}
    phonemes: dict[str, list[str]] = {}
    missing: list[str] = []
    for word in dict.fromkeys(tokenise(text)):
        variants = overrides.get(word) or [lexicon.format_variant(v) for v in lexicon.lookup(word)]
        if variants:
            phonemes[word] = variants
        else:
            missing.append(word)
    return phonemes, missing
