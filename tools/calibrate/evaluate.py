"""Scoring a gold clip with the real engine and turning the verdict into what the report counts."""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, fields, replace
from pathlib import Path

API = Path(__file__).resolve().parents[2] / "api"
if str(API) not in sys.path:  # the engine is plain Python (no Django); reuse it, never copy it
    sys.path.insert(0, str(API))

from twisters.speak.engine.assess import assess  # noqa: E402
from twisters.speak.engine.types import Posteriors, ScoringProfile, Word  # noqa: E402

from gold import Clip  # noqa: E402

DEFAULT_PROFILE = ScoringProfile()
THRESHOLD_FIELDS = {f.name: f.type for f in fields(ScoringProfile)}


def profile_from(thresholds: dict | None, name: str = "calibration") -> ScoringProfile:
    """Server-style thresholds JSON over the defaults; unknown keys and non-numbers are ignored, like the apps do."""
    accepted: dict = {"name": name}
    for key, value in (thresholds or {}).items():
        kind = THRESHOLD_FIELDS.get(key)
        if kind is None or key == "name" or isinstance(value, bool) or not isinstance(value, int | float):
            continue
        accepted[key] = int(value) if kind in ("int", int) else float(value)
    return replace(DEFAULT_PROFILE, **accepted)


def load_profile(path: str | Path | None) -> ScoringProfile:
    if path is None:
        return DEFAULT_PROFILE
    data = json.loads(Path(path).read_text())
    return profile_from(data.get("thresholds", data), data.get("code", Path(path).stem))


@dataclass(frozen=True)
class WordOutcome:
    index: int
    status: str
    reason: str
    uncertain: bool


@dataclass(frozen=True)
class ClipResult:
    clip: Clip
    unscorable: str | None
    score: int | None
    words: list[WordOutcome]
    #: (target phone, phone the engine heard) for every substitution it reported, for the confusion table
    confusions: tuple[tuple[str, str], ...] = ()

    @property
    def scored(self) -> bool:
        return self.unscorable is None

    def word(self, index: int) -> WordOutcome | None:
        return next((w for w in self.words if w.index == index), None)

    @property
    def accused(self) -> list[WordOutcome]:
        """Words the engine called wrong (a swap or a substitution it is sure of)."""
        return [w for w in self.words if w.status == "wrong"]

    @property
    def abstained(self) -> list[WordOutcome]:
        """Words the engine declined to judge (it gave the benefit of the doubt instead of accusing)."""
        return [w for w in self.words if w.uncertain]


def score_clip(clip: Clip, profile: ScoringProfile = DEFAULT_PROFILE) -> ClipResult:
    words = [Word(text, variants) for text, variants in clip.words]
    result = assess(
        Posteriors(clip.vocab, clip.logp),
        words,
        clip.focus,
        profile=profile,
        duration_ms=clip.duration_ms,
        difficulty=clip.difficulty,
    )
    if result.unscorable:
        return ClipResult(clip, result.unscorable, None, [])
    kept = [w for w in result.words if w.status != "extra"]
    return ClipResult(
        clip,
        None,
        result.score,
        [WordOutcome(w.index, w.status, w.reason, w.uncertain) for w in kept],
        tuple((p.target, p.heard) for w in kept for p in w.phonemes if p.verdict == "substituted"),
    )
