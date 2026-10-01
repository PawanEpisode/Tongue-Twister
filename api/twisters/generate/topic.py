"""The user's topic is data, never instructions (D26): cleaned here, and only ever embedded in a prompt
as a JSON string value (`prompts.py`)."""

import unicodedata

from .. import names

TOPIC_MAX = 120
TOPIC_MIN = 2


def clean(raw: str) -> str:
    """NFC, control / format / invisible characters removed (a newline becomes a space), whitespace
    collapsed. Length is the caller's check (`TOPIC_MAX`), made before and after cleaning."""
    text = unicodedata.normalize("NFC", raw)
    text = "".join(" " if c.isspace() else c for c in text if not _is_invisible(c))
    return " ".join(text.split())


def _is_invisible(char: str) -> bool:
    return unicodedata.category(char).startswith("C") and not char.isspace()


def is_allowed(topic: str) -> bool:
    return not names.has_blocked_word(topic)
