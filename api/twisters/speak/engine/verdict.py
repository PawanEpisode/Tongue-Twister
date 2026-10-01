"""Phoneme verdicts, word status and fusion with the optional text layer (doc 10 §4.6-4.8)."""

from collections.abc import Sequence

from .types import (
    CORRECT,
    DELETED,
    FOCUS_SWAP,
    MISSED,
    NEAR,
    OK,
    SLURRED,
    SUBSTITUTED,
    UNCERTAIN,
    WEAK,
    WRONG,
    PhonemeResult,
    ScoringProfile,
)

UNCERTAIN_REASON = "uncertain"


def phoneme_verdict(
    profile: ScoringProfile,
    peak_lp: float,
    sub_delta: float | None,
    del_delta: float | None,
) -> tuple[str, bool]:
    """Returns ``(verdict, deletion_won)``. Both tests failing: the more negative delta wins, ties go to substitution."""
    sub_hit = sub_delta is not None and sub_delta <= -profile.tau_sub
    del_hit = del_delta is not None and del_delta <= -profile.tau_del
    if sub_hit and del_hit:
        assert sub_delta is not None and del_delta is not None
        return (DELETED, True) if del_delta < sub_delta else (SUBSTITUTED, False)
    if sub_hit:
        return SUBSTITUTED, False
    if del_hit:
        return DELETED, True
    deltas = [d for d in (sub_delta, del_delta) if d is not None]
    if deltas and min(deltas) <= -profile.tau_uncertain:
        return UNCERTAIN, False
    if peak_lp < profile.tau_weak:
        return WEAK, False
    return OK, False


def word_status(phonemes: Sequence[PhonemeResult]) -> tuple[str, str, bool]:
    """``(status, reason, uncertain)`` from the phoneme verdicts (doc 10 §4.7); `missed` is decided earlier."""
    uncertain = any(p.verdict == UNCERTAIN for p in phonemes)
    errors = [p for p in phonemes if p.verdict in (SUBSTITUTED, DELETED)]
    if any(p.focus for p in errors):
        return WRONG, FOCUS_SWAP, uncertain
    if len(errors) >= 2:
        return WRONG, "", uncertain
    if len(errors) == 1:
        return NEAR, "", uncertain
    if any(p.verdict == WEAK for p in phonemes):
        return NEAR, SLURRED, uncertain
    return CORRECT, "", uncertain


def fuse(status: str, reason: str, uncertain: bool, text_match: bool | None) -> tuple[str, str]:
    """Combine with the Web Speech layer. It can never turn an acoustic error into `correct` (E1)."""
    if text_match is None or status == MISSED:
        return status, reason
    if status == CORRECT and uncertain and not text_match:
        return NEAR, UNCERTAIN_REASON
    return status, reason
