"""Scoring v2 (PRD 03 §6), Django-free. Mirrored in ``web/src/lib/speak/score.ts``; shared vectors keep them equal.

credit   correct 1.0 · near 0.6 · wrong 0 · missed 0 · extra -0.15 (all extras capped at -0.5)
accuracy max(0, sum(credit) / target_words)
speed    clamp(wpm / reference_wpm(level))            only when accuracy >= 0.6
fluency  1 - clamp(long_pause_ms / (0.35 * duration_ms))
score    round(100 * (0.70 accuracy + 0.20 speed + 0.10 fluency)), capped at 79 by a focus swap
"""

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

# Plain strings, not the Django enums: this module is vendored into the worker (docs/features/13 D37).
# `tests/test_engine_units.py` pins every constant here to `WordStatus` / `WordReason`.
CORRECT, NEAR, WRONG, MISSED, EXTRA = "correct", "near", "wrong", "missed", "extra"
STATUSES = (CORRECT, NEAR, WRONG, MISSED, EXTRA)
FOCUS_SWAP = "focus_swap"

CREDIT = {CORRECT: 1.0, NEAR: 0.6, WRONG: 0.0, MISSED: 0.0, EXTRA: -0.15}
EXTRA_PENALTY_CAP = -0.5
SPEED_MIN_ACCURACY = 0.6
PAUSE_SHARE = 0.35  # of speaking time; pauses longer than 700 ms are measured by the client
WEIGHTS = (0.70, 0.20, 0.10)
FOCUS_SCORE_CAP = 79  # below "pass" (80) and mastery (90), decision D10
MIN_DURATION_MS = 500

REFERENCE_WPM = {1: 110, 2: 130, 3: 150, 4: 170}  # Easy · Medium · Hard · Insane


@dataclass(frozen=True)
class Score:
    accuracy: float
    speed: float
    fluency: float
    completeness: float
    wpm: float
    score: int
    focus_gated: bool
    counts: dict[str, int]


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def credit_for(status: str) -> float:
    return CREDIT[status]


def word_counts(statuses: Sequence[str]) -> dict[str, int]:
    counter = Counter(statuses)
    return {status: counter.get(status, 0) for status in STATUSES}


def compute(
    statuses: Sequence[str],
    reasons: Sequence[str],
    *,
    target_words: int,
    spoken_words: int,
    duration_ms: int,
    long_pause_ms: int,
    difficulty: int,
) -> Score:
    """`statuses` / `reasons` are parallel lists over every aligned row (targets and extras)."""
    counts = word_counts(statuses)
    extras = max(EXTRA_PENALTY_CAP, counts[EXTRA] * CREDIT[EXTRA])
    credit = sum(CREDIT[s] * counts[s] for s in (CORRECT, NEAR, WRONG, MISSED))
    accuracy = _clamp((credit + extras) / target_words) if target_words else 0.0
    completeness = _clamp((counts[CORRECT] + counts[NEAR]) / target_words) if target_words else 0.0

    duration = max(duration_ms, MIN_DURATION_MS)
    wpm = spoken_words / (duration / 60000)
    reference = REFERENCE_WPM.get(difficulty, REFERENCE_WPM[2])
    speed = _clamp(wpm / reference) if accuracy >= SPEED_MIN_ACCURACY else 0.0
    fluency = 1.0 - _clamp(long_pause_ms / (PAUSE_SHARE * duration))

    raw = 100 * (WEIGHTS[0] * accuracy + WEIGHTS[1] * speed + WEIGHTS[2] * fluency)
    gated = FOCUS_SWAP in reasons
    uncapped = int(raw + 0.5)  # round half up, identical to JS Math.round
    score = min(uncapped, FOCUS_SCORE_CAP) if gated else uncapped
    return Score(
        accuracy=round(accuracy, 4),
        speed=round(speed, 4),
        fluency=round(fluency, 4),
        completeness=round(completeness, 4),
        wpm=round(wpm, 1),
        score=score,
        focus_gated=gated and uncapped > FOCUS_SCORE_CAP,
        counts=counts,
    )
