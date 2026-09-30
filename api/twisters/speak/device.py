"""Accepting acoustic verdicts from the device engine (docs/features/10 §5).

The device reports per-word statuses and per-phoneme verdicts; the *server* still recomputes the
score from them, so a client cannot simply claim "92". Text-layer alignment stays the source of
truth for extras and for any word the device did not report. An acoustic verdict always wins over
the text layer (it can never be turned back into `correct`, docs/features/10 §4.8).
"""

from dataclasses import dataclass, field

from ..models import PhonemeVerdict, WordReason, WordStatus
from . import pipeline
from .alignment import Aligned
from .similarity import Match

MAX_PHONEMES_PER_WORD = 40
DEVICE_STATUSES = {WordStatus.CORRECT, WordStatus.NEAR, WordStatus.WRONG, WordStatus.MISSED}


class DeviceResultError(ValueError):
    """The reported words do not describe this twister (tampering or a stale twister version)."""


@dataclass(frozen=True)
class DevicePhoneme:
    target: str
    verdict: str
    heard: str | None = None
    variant: str = ""
    delta: float | None = None
    lpp: float | None = None
    lpr: float | None = None
    start_ms: int | None = None
    end_ms: int | None = None


@dataclass(frozen=True)
class DeviceWord:
    index: int
    target: str
    status: str
    reason: str = ""
    confidence: float | None = None
    acoustic_score: float | None = None
    phoneme_distance: float | None = None
    start_ms: int | None = None
    end_ms: int | None = None
    phonemes: list[DevicePhoneme] = field(default_factory=list)


def validate(words: list[DeviceWord], targets: list[str]) -> dict[int, DeviceWord]:
    by_index: dict[int, DeviceWord] = {}
    for w in words:
        if not 0 <= w.index < len(targets):
            raise DeviceResultError(f"word index {w.index} is outside the twister")
        if w.index in by_index:
            raise DeviceResultError(f"word {w.index} reported twice")
        if w.target != targets[w.index]:
            raise DeviceResultError(
                f"word {w.index} is '{w.target}', expected '{targets[w.index]}'"
            )
        if w.status not in DEVICE_STATUSES:
            raise DeviceResultError(f"word {w.index} has status '{w.status}'")
        if w.reason == WordReason.FOCUS_SWAP and w.status != WordStatus.WRONG:
            raise DeviceResultError("a focus swap makes the word wrong")
        if len(w.phonemes) > MAX_PHONEMES_PER_WORD:
            raise DeviceResultError(f"word {w.index} has too many phonemes")
        for p in w.phonemes:
            if p.verdict == PhonemeVerdict.SUBSTITUTED and (not p.heard or p.heard == p.target):
                raise DeviceResultError("a substitution must say which sound was heard")
        by_index[w.index] = w
    return by_index


def merge(
    evaluation: pipeline.Evaluation, targets: list[str], words: list[DeviceWord]
) -> tuple[pipeline.Evaluation, dict[int, DeviceWord]]:
    """Overlay the device verdicts on the text alignment and score again."""
    device = validate(words, targets)
    merged: list[Aligned] = []
    for aligned in evaluation.words:
        report = device.get(aligned.target_index) if aligned.target_index is not None else None
        if report is None:
            merged.append(aligned)
        else:
            merged.append(
                Aligned(
                    aligned.target_index,
                    aligned.spoken_index,
                    aligned.target_word,
                    aligned.spoken_word,
                    Match(report.status, report.reason),
                )
            )
    return pipeline.with_words(evaluation, merged), device
