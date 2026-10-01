"""Output validation (D26): nothing a generator returns is stored until it passes every check here.

Each failure is a stable reason code (`generation_rejected` -> `details.reason`). The checks are
structural on purpose: they hold whatever the model was tricked into saying, so they are the defence
against prompt injection, not the prompt.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from .. import names
from ..speak import pronunciations
from .drafts import Draft

MIN_CHARS, MAX_CHARS = 20, 240
MIN_WORDS, MAX_WORDS = 8, 40
TIP_MAX = 240
FOCUS_MAX_ITEMS, FOCUS_MAX_LEN = 4, 3

# English letters and ordinary punctuation: no digits, symbols, markup, links, or other scripts.
_TEXT = re.compile(r"[A-Za-z][A-Za-z'\" ,.;:!?\-]*")
# A dot between two letters is a domain or file name ("example.com"), never a sentence.
_LINKISH = re.compile(r"[A-Za-z]\.[A-Za-z]|\bwww\b|\bhttps?\b", re.IGNORECASE)
_FOCUS = re.compile(r"[a-z]{1,3}")
_TYPOGRAPHIC = str.maketrans(
    {
        "’": "'",
        "‘": "'",
        "“": '"',
        "”": '"',
        "–": "-",
        "—": "-",
        "…": "...",
    }
)


class Rejected(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Validated:
    text: str
    tip: str
    focus_sounds: list[str]
    phonemes: dict[str, list[str]]


def _normalise(raw: str) -> str:
    text = unicodedata.normalize("NFKC", raw).translate(_TYPOGRAPHIC)
    return " ".join(text.split())


def _check_text(text: str) -> None:
    if not text:
        raise Rejected("empty_output")
    if len(text) < MIN_CHARS:
        raise Rejected("too_short")
    if len(text) > MAX_CHARS:
        raise Rejected("too_long")
    if not _TEXT.fullmatch(text) or _LINKISH.search(text):
        raise Rejected("unsupported_characters")
    words = len(text.split())
    if words < MIN_WORDS:
        raise Rejected("too_few_words")
    if words > MAX_WORDS:
        raise Rejected("too_many_words")
    if names.has_blocked_word(text):
        raise Rejected("blocked_content")


def _clean_tip(raw: str) -> str:
    """A tip is a nicety: anything odd about it drops the tip, it does not sink the twister."""
    tip = _normalise(raw)
    if not tip or len(tip) > TIP_MAX or names.has_blocked_word(tip):
        return ""
    return tip if _TEXT.fullmatch(tip) else ""


def _clean_focus(raw: list[str]) -> list[str]:
    sounds = [s for s in (_normalise(item).lower() for item in raw) if _FOCUS.fullmatch(s)]
    return list(dict.fromkeys(sounds))[:FOCUS_MAX_ITEMS]


def validate(draft: Draft) -> Validated:
    """The checked twister, or `Rejected(reason)`. Also resolves its pronunciations: a word the lexicon
    cannot place cannot be scored, which also catches non-English and made-up output (D10)."""
    text = _normalise(draft.text)
    _check_text(text)
    phonemes, unknown = pronunciations.resolve(text, pronunciations.override_index())
    if unknown:
        raise Rejected("unknown_words")
    return Validated(
        text=text,
        tip=_clean_tip(draft.tip),
        focus_sounds=_clean_focus(draft.focus_sounds),
        phonemes=phonemes,
    )
