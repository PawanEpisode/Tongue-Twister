"""Word-level comparison: exact, homophone, near, wrong — and 'focus swap' (decision D10).

A focus swap is a slip on the very sound the twister trains ("sells" said as "shells" in an S/SH
twister). It is `wrong` even though the words are one letter apart, because that slip is the point of
the exercise. Text alone cannot hear the sound, so the rule is the text-layer approximation of the
acoustic substitution test in docs/features/10 §4.5 and is replaced by it when a device result exists.
"""

from collections.abc import Collection
from dataclasses import dataclass

from ..models import WordReason, WordStatus
from .normalise import homophones

NEAR_MIN_LETTERS = 4  # PRD 03 §5.1: "edit distance <= 1 on >= 4 letters"


@dataclass(frozen=True)
class Match:
    status: str
    reason: str = ""


CORRECT = Match(WordStatus.CORRECT)
NEAR = Match(WordStatus.NEAR)
HOMOPHONE = Match(WordStatus.NEAR, WordReason.HOMOPHONE)
FOCUS_SWAP = Match(WordStatus.WRONG, WordReason.FOCUS_SWAP)
WRONG = Match(WordStatus.WRONG)


def single_edit_span(a: str, b: str) -> tuple[int, int] | None:
    """If `b` is `a` with exactly one letter substituted, inserted or deleted, return the edited
    span in `a` as (start, end); an insertion is an empty span (start == end). Otherwise None."""
    if a == b or abs(len(a) - len(b)) > 1:
        return None
    i = 0
    limit = min(len(a), len(b))
    while i < limit and a[i] == b[i]:
        i += 1
    if len(a) == len(b):
        return (i, i + 1) if a[i + 1 :] == b[i + 1 :] else None
    if len(b) == len(a) + 1:
        return (i, i) if a[i:] == b[i + 1 :] else None
    return (i, i + 1) if a[i + 1 :] == b[i:] else None


def _touches_focus(word: str, span: tuple[int, int], focus: Collection[str]) -> bool:
    start, end = span
    for sound in focus:
        at = word.find(sound)
        while at != -1:
            f_start, f_end = at, at + len(sound)
            # An insertion next to a focus sound ("s" -> "sh") counts as touching it.
            touches = f_start <= start <= f_end if start == end else start < f_end and end > f_start
            if touches:
                return True
            at = word.find(sound, at + 1)
    return False


def classify(
    target: str,
    spoken: str,
    focus: Collection[str] = (),
    accepted: Collection[str] = (),
) -> Match:
    if spoken == target or spoken in accepted:
        return CORRECT
    if "'" in target and spoken == target.replace("'", ""):
        return CORRECT  # recognisers drop the apostrophe: "sams" for "sam's"
    if target.endswith("'s") and spoken == target[:-2]:
        return NEAR  # the possessive "s" is soft; the base word alone is close, not right
    if spoken in homophones(target):
        return HOMOPHONE
    span = single_edit_span(target, spoken)
    if span is None:
        return WRONG
    if len(target) >= 2 and _touches_focus(target, span, focus):
        return FOCUS_SWAP
    return NEAR if min(len(target), len(spoken)) >= NEAR_MIN_LETTERS else WRONG
