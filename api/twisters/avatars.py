"""Validation for the emoji avatar a person picks for themselves.

The avatar is rendered in the header, on the profile page and next to shared names, so it must be exactly
one pictograph and nothing that could carry text or markup. We accept symbol characters (Unicode `So`,
`Sk`) plus the three joiners that emoji sequences use, and cap the length so a stray paragraph cannot
fit. Letters, digits, punctuation, whitespace and control characters are all refused.
"""

import unicodedata

from django.core.exceptions import ValidationError

AVATAR_EMOJI_MAX = 8
DEFAULT_AVATAR_EMOJI = "🗣️"

# Zero-width joiner, emoji variation selector-16, combining enclosing keycap, and the tag characters
# used by subdivision flags (England, Scotland, Wales).
_JOINERS = frozenset({"‍", "️", "⃣"})
_TAG_RANGE = range(0xE0020, 0xE0080)


def _is_pictograph(char: str) -> bool:
    return char in _JOINERS or ord(char) in _TAG_RANGE or unicodedata.category(char) in {"So", "Sk"}


def validate_avatar_emoji(value: str) -> None:
    """Django validator (also runs inside DRF). An avatar can be changed but never blank."""
    if not value or not value.strip():
        raise ValidationError("Pick an emoji.", code="blank")
    if len(value) > AVATAR_EMOJI_MAX:
        raise ValidationError("Pick a single emoji.", code="max_length")
    if not all(_is_pictograph(c) for c in value):
        raise ValidationError("Use an emoji, not letters, numbers or symbols.", code="invalid")
