"""Pronunciation engine (docs/features/10, 13).

Pure functions over a frame-posterior matrix: CTC forward and Viterbi, two-pass alignment, GOP features,
substitution and deletion tests, verdicts, word status, text-layer fusion and the attempt score. No Django, no
numpy, no model and no audio, so the same files run in the API (variant expansion, reference scoring) and,
vendored byte for byte by ``worker/scripts/sync_engine.py``, in the scoring worker. ``web/src/lib/speak/engine``
is the TypeScript port the browser runs; all three agree on ``api/tests/fixtures/engine_vectors.json``.
"""

from .assess import assess
from .types import Assessment, Posteriors, ScoringProfile, Word

__all__ = ["Assessment", "Posteriors", "ScoringProfile", "Word", "assess"]
