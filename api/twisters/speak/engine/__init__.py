"""Pronunciation engine groundwork (docs/features/10, E3-2a/E3-2b; spec 17 section A6).

Pure functions over a frame-posterior matrix: CTC forward and Viterbi, two-pass alignment, GOP features,
substitution and deletion tests, verdicts, word status, text-layer fusion and the attempt score. No Django, no
numpy, no model and no audio; a real acoustic model plugs in later behind ``interfaces.AcousticModel``.

Nothing here is imported by the Speak views, service or pipeline: the engine is not wired until the
``accurate_mode`` work (E3-4). ``web/src/lib/speak/engine`` is its TypeScript port; both run the same vectors
(``api/tests/fixtures/engine_vectors.json``).
"""

from .assess import assess
from .types import Assessment, Posteriors, ScoringProfile, Word

__all__ = ["Assessment", "Posteriors", "ScoringProfile", "Word", "assess"]
