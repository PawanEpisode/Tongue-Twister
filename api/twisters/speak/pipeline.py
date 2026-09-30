"""Turn (twister, transcript, timing) into aligned words and a v2 score. Pure: no database access."""

from collections.abc import Collection
from dataclasses import dataclass, field

from django.conf import settings

from ..models import WordStatus
from . import scoring
from .alignment import Aligned, align, merge_split_compounds
from .normalise import tokenise

MAX_SPOKEN_TOKENS = 800  # bounds the alignment matrix whatever a client sends
LOW_SNR_DB = 10.0
NOISY_ERROR_SHARE = 0.4  # PRD 03 §6: > 40 % near/wrong on very poor audio => "couldn't hear you"


class Unscorable:
    """Reasons an attempt is answered with "We couldn't hear you clearly" instead of a score."""

    NO_SPEECH = "no_speech"
    LOW_CONFIDENCE = "low_confidence"
    QUALITY_GATE = "quality_gate"
    TOO_NOISY = "too_noisy"


@dataclass(frozen=True)
class Evaluation:
    words: list[Aligned]
    score: scoring.Score
    target_words: int
    spoken_words: int
    duration_ms: int
    long_pause_ms: int
    difficulty: int
    flags: list[str] = field(default_factory=list)  # anti-cheat findings, e.g. "unusually_fast"

    @property
    def statuses(self) -> list[str]:
        return [w.status for w in self.words]


def evaluate(
    target_text: str,
    transcript: str,
    *,
    duration_ms: int,
    long_pause_ms: int = 0,
    difficulty: int = 2,
    focus_sounds: Collection[str] = (),
    accepted: dict[str, Collection[str]] | None = None,
) -> Evaluation:
    targets = tokenise(target_text)
    spoken = tokenise(transcript)[:MAX_SPOKEN_TOKENS]
    focus = [f.lower() for f in focus_sounds]
    words = align(targets, merge_split_compounds(targets, spoken), focus=focus, accepted=accepted)
    return _build(words, len(targets), len(spoken), duration_ms, long_pause_ms, difficulty)


def _build(
    words: list[Aligned],
    target_words: int,
    spoken_words: int,
    duration_ms: int,
    long_pause_ms: int,
    difficulty: int,
) -> Evaluation:
    long_pause_ms = min(long_pause_ms, duration_ms)
    result = scoring.compute(
        [w.status for w in words],
        [w.reason for w in words],
        target_words=target_words,
        spoken_words=spoken_words,
        duration_ms=duration_ms,
        long_pause_ms=long_pause_ms,
        difficulty=difficulty,
    )
    flags = ["unusually_fast"] if result.wpm > settings.MAX_PLAUSIBLE_WPM else []
    return Evaluation(
        words, result, target_words, spoken_words, duration_ms, long_pause_ms, difficulty, flags
    )


def with_words(evaluation: Evaluation, words: list[Aligned]) -> Evaluation:
    """Same take, different verdicts (a device engine overriding the text layer): score again."""
    return _build(
        words,
        evaluation.target_words,
        evaluation.spoken_words,
        evaluation.duration_ms,
        evaluation.long_pause_ms,
        evaluation.difficulty,
    )


def unscorable_reason(
    evaluation: Evaluation, *, confidence: float | None, quality: dict | None
) -> str | None:
    """Why this take must not be scored (and must not be saved), or None when it is fine."""
    if evaluation.spoken_words == 0:
        return Unscorable.NO_SPEECH
    if confidence is not None and confidence < settings.MIN_ENGINE_CONFIDENCE:
        return Unscorable.LOW_CONFIDENCE
    quality = quality or {}
    if quality.get("ok") is False:
        return Unscorable.QUALITY_GATE
    snr = quality.get("snr_db")
    if isinstance(snr, int | float) and snr < LOW_SNR_DB:
        counts = evaluation.score.counts
        bad = counts[WordStatus.NEAR] + counts[WordStatus.WRONG]
        if evaluation.target_words and bad / evaluation.target_words > NOISY_ERROR_SHARE:
            return Unscorable.TOO_NOISY
    return None
