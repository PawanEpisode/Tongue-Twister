"""Builds ``fixtures/quality_vectors.json``: signals described by parameters (both ports render them with the
same formula, so the fixture stays small) and the gate outcome each must produce.

Run ``python -m tests.quality_vector_gen`` from ``api/`` to rewrite the file; ``test_engine_quality.py`` fails
when the stored file differs from a fresh build.
"""

import json
import math
from pathlib import Path

from twisters.speak.engine.quality import posterior_gate, signal_gate, speech_bounds
from twisters.speak.engine.types import Posteriors, ScoringProfile

PATH = Path(__file__).parent / "fixtures" / "quality_vectors.json"


def render(spec: dict) -> list[float]:
    """x[i] = amp * burst(i) * (sin(2 pi f i / sr) + 0.5 sin(2 pi 2f i / sr)) / 1.5 + floor * sin(2 pi 97 i / sr),
    hard-clipped to +-1. burst is 1 for the first `duty` of every `period_s`."""
    sr = spec["sample_rate"]
    n = int(spec["seconds"] * sr)
    out = []
    for i in range(n):
        t = i / sr
        shifted = t - spec.get("lead_s", 0.0)
        on = (
            1.0
            if shifted >= 0 and (shifted % spec["period_s"]) < spec["duty"] * spec["period_s"]
            else 0.0
        )
        voiced = math.sin(2 * math.pi * spec["freq"] * t) + 0.5 * math.sin(
            2 * math.pi * 2 * spec["freq"] * t
        )
        x = spec["amp"] * on * voiced / 1.5 + spec["floor"] * math.sin(2 * math.pi * 97 * t)
        out.append(max(-1.0, min(1.0, x)))
    return out


BASE = {
    "sample_rate": 16000,
    "seconds": 2.0,
    "amp": 0.3,
    "freq": 180,
    "period_s": 0.5,
    "duty": 0.6,
    "floor": 0.0005,
}
SIGNALS = [
    ("clean", {}),
    ("quiet", {"amp": 0.002}),
    ("noisy", {"floor": 0.15}),
    ("clipped", {"amp": 6.0}),
    ("low_rate", {"sample_rate": 8000}),
    ("continuous_speech", {"duty": 1.0}),
    ("silence", {"amp": 0.0, "floor": 0.0}),
    ("tiny", {"seconds": 0.01}),
    ("hardware_8k_resampled", {"capture_rate": 8000}),
    ("padded_read", {"seconds": 3.0, "period_s": 3.0, "duty": 0.5, "lead_s": 0.8}),
]


def posterior_cases() -> list[dict]:
    """Class posteriors over 5 classes (blank first) as per-frame logp rows."""

    def row(best: int, peak: float = 0.9) -> list[float]:
        rest = (1 - peak) / 4
        return [math.log(peak if k == best else rest) for k in range(5)]

    blank = row(0)
    voiced = [row(1), row(2), row(3), row(4)]
    read = [blank] * 5 + [voiced[i % 4] if i % 2 == 0 else blank for i in range(40)] + [blank] * 5
    short = [blank] * 40 + [voiced[0], blank, voiced[1]] + [blank] * 40
    muddy = [
        math.log(v) for v in (0.15, 0.3, 0.2, 0.2, 0.15)
    ]  # argmax is a phone, but nothing is clear
    confused = [blank] * 5 + [muddy] * 40 + [blank] * 5
    return [
        {"name": "full_read", "logp": read, "expected_ms": 600.0},
        {"name": "short_read", "logp": short, "expected_ms": 2000.0},
        {"name": "all_blank", "logp": [blank] * 50, "expected_ms": 1000.0},
        {
            "name": "confused",
            "logp": confused,
            "expected_ms": 600.0,
            "profile": {"gate_max_entropy": 1.2},
        },
        {"name": "confused_default_profile", "logp": confused, "expected_ms": 600.0},
        {"name": "zero_expected", "logp": read, "expected_ms": 0.0},
    ]


def build() -> dict:
    signals = []
    for name, over in SIGNALS:
        spec = {**BASE, **over}
        samples = render(spec)
        result = signal_gate(samples, spec["sample_rate"], capture_rate=spec.get("capture_rate"))
        start, end = speech_bounds(samples, spec["sample_rate"])
        signals.append(
            {"name": name, "spec": spec, "expect": result.__dict__, "bounds": [start, end]}
        )
    posteriors = []
    for case in posterior_cases():
        post = Posteriors(("<b>", "A", "B", "C", "D"), case["logp"])
        result = posterior_gate(
            post, case["expected_ms"], ScoringProfile(**case.get("profile", {}))
        )
        posteriors.append({**case, "expect": result.__dict__})
    return {"signals": signals, "posteriors": posteriors}


if __name__ == "__main__":
    PATH.write_text(json.dumps(build(), indent=1) + "\n")
    print(f"wrote {PATH}")
