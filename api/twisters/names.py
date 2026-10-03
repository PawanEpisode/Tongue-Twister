"""Validation for the opt-in public name shown on shared recordings (spec 13 A2.5).

There is no leaderboard name filter to reuse, so this is the one shared check. It is deliberately
conservative: a short blocklist matched after folding case, accents and common look-alike characters,
plus a ban on anything that could carry contact details or markup. Empty means "stay anonymous".
"""

import re
import unicodedata

from django.core.exceptions import ValidationError

PUBLIC_NAME_MAX = 40
DISPLAY_NAME_MIN = 2

# Minimal, obvious terms only; extend here. Matched as substrings of the folded name.
BLOCKED_TERMS = (
    "fuck",
    "shit",
    "bitch",
    "cunt",
    "nigg",
    "fagg",
    "whore",
    "slut",
    "nazi",
    "hitler",
    "admin",
    "moderator",
    "twister team",
)

_LOOKALIKES = str.maketrans(
    {"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "$": "s", "@": "a", "!": "i"}
)
_WORDS = re.compile(r"[^\W_]+(?:['\u2019][^\W_]+)*")
_CONTACT = re.compile(r"[@<>]|://|www\.|\.(com|net|org|io)\b", re.IGNORECASE)


def _fold(value: str) -> str:
    """Lower-case, strip accents and look-alike digits/symbols so `sh1t` and `ṡhit` both match."""
    base = unicodedata.normalize("NFKD", value)
    base = "".join(c for c in base if not unicodedata.combining(c)).casefold()
    return re.sub(r"[\s._\-*]+", "", base.translate(_LOOKALIKES))


_FOLDED_TERMS = tuple(_fold(term) for term in BLOCKED_TERMS)


def validate_public_name(value: str) -> None:
    """Django validator (also runs inside DRF). Blank is always allowed."""
    if not value:
        return
    if len(value) > PUBLIC_NAME_MAX:
        raise ValidationError(f"Use at most {PUBLIC_NAME_MAX} characters.", code="max_length")
    if any(unicodedata.category(c).startswith("C") for c in value):
        raise ValidationError("That name contains invisible characters.", code="invalid")
    if _CONTACT.search(value):
        raise ValidationError("Leave out emails, links and markup.", code="invalid")
    folded = _fold(value)
    if any(term in folded for term in _FOLDED_TERMS):
        raise ValidationError("Please choose a different name.", code="blocked")


def validate_display_name(value: str) -> None:
    """The name a person calls themselves. Same safety rules as the public name, but it can never be
    blank and needs a couple of characters, so the header and profile always have something to show."""
    if len(clean_public_name(value)) < DISPLAY_NAME_MIN:
        raise ValidationError(f"Use at least {DISPLAY_NAME_MIN} characters.", code="min_length")
    validate_public_name(value)


def has_blocked_word(text: str) -> bool:
    """True when any single *word* of free text contains a blocked term (same folding as names, so
    `sh1t` matches). Words are checked one by one, never glued together: running prose through the
    name check would flag harmless pairs such as "pass hit"."""
    return any(term in _fold(word) for word in _WORDS.findall(text) for term in _FOLDED_TERMS)


def clean_public_name(value: str) -> str:
    """Canonical stored form: NFC, single spaces, trimmed."""
    return " ".join(unicodedata.normalize("NFC", value).split())
