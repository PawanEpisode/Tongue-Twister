"""Scoring v2 (PRD 03 §6). The implementation lives in ``engine/score.py`` (Django-free, so the worker can
vendor it); this module keeps the long-standing import path. Mirrored in ``web/src/lib/speak/score.ts``."""

from .engine.score import (  # noqa: F401
    CREDIT,
    EXTRA_PENALTY_CAP,
    FOCUS_SCORE_CAP,
    MIN_DURATION_MS,
    PAUSE_SHARE,
    REFERENCE_WPM,
    SPEED_MIN_ACCURACY,
    WEIGHTS,
    Score,
    compute,
    credit_for,
    word_counts,
)
