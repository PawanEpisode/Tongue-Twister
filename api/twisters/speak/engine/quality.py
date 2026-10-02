"""Quality gates (docs/features/13 section 3.7): decide, before scoring, whether a read is worth judging.

Two gates, both pure and deterministic, mirrored in ``web/src/lib/speak/engine/quality.ts`` and pinned by
``api/tests/fixtures/quality_vectors.json``:

* ``signal_gate``     on the raw mono samples, before the model runs (saves the inference when the clip is
                      hopeless): sample rate, loudness, clipping, signal-to-noise.
* ``posterior_gate``  on the class posteriors, after the model runs: the read covers too little of the time the
                      twister needs, or the model is confused (high-entropy) for most of the speech.

A failed gate produces no score and is never sent as an attempt. Thresholds live in ``ScoringProfile`` so the
calibration (A3) can tune them without a deploy. The gates never accuse a speaker of a mispronunciation: they
only say "this recording cannot be judged".

Deviation from the spec table, on purpose: "speech frames" for the too-short gate is the *span* from the first to
the last non-blank frame, not the count of non-blank frames. CTC posteriors are peaky (one or two non-blank
frames per phone, blanks between), so a count would call every normal read too short.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass

from .score import REFERENCE_WPM
from .types import FRAME_MS, Posteriors, ScoringProfile

TOO_SHORT = "too_short"
TOO_QUIET = "too_quiet"
TOO_NOISY = "too_noisy"
CLIPPING = "clipping"
LOW_SAMPLE_RATE = "low_sample_rate"
BACKGROUND_SOUND = "background_sound"

LOUD_SHARE = 0.30  # the loudest 30 % of frames define "speech level"
FLOOR_PERCENTILE = 0.10
SPEECH_PERCENTILE = 0.90
CLIP_LEVEL = 0.99
SILENCE_DBFS = -180.0  # what an all-zero frame reads as, instead of -inf


@dataclass(frozen=True)
class Quality:
    ok: bool
    gate: str | None
    loud_dbfs: float | None = None
    snr_db: float | None = None
    clip_share: float | None = None
    speech_share: float | None = None
    entropy_share: float | None = None


def _dbfs(power: float) -> float:
    return 10 * math.log10(power) if power > 0 else SILENCE_DBFS


def _frame_powers(samples: Sequence[float], frame: int) -> list[float]:
    n = len(samples) // frame
    return [
        math.fsum(x * x for x in samples[i * frame : (i + 1) * frame]) / frame for i in range(n)
    ]


def _percentile(sorted_values: list[float], q: float) -> float:
    return sorted_values[
        int(q * (len(sorted_values) - 1))
    ]  # nearest rank, no interpolation: same in every port


def signal_gate(
    samples: Sequence[float],
    sample_rate: int,
    profile: ScoringProfile | None = None,
    capture_rate: int | None = None,
) -> Quality:
    """``capture_rate`` is the microphone's own rate before any resampling to ``sample_rate`` (the sample rate
    gate asks about the hardware, not about our 16 kHz copy); it defaults to ``sample_rate``."""
    profile = profile or ScoringProfile()
    if (capture_rate or sample_rate) < profile.gate_min_sample_rate:
        return Quality(False, LOW_SAMPLE_RATE)
    frame = sample_rate * FRAME_MS // 1000
    powers = _frame_powers(samples, frame)
    if not powers:
        return Quality(False, TOO_SHORT)
    clipped = sum(1 for x in samples if abs(x) >= CLIP_LEVEL)
    clip_share = clipped / len(samples)
    ordered = sorted(powers, reverse=True)
    loud_count = max(1, math.ceil(LOUD_SHARE * len(ordered)))
    loud = _dbfs(math.fsum(ordered[:loud_count]) / loud_count)
    db = sorted(_dbfs(p) for p in powers)
    snr = _percentile(db, SPEECH_PERCENTILE) - _percentile(db, FLOOR_PERCENTILE)

    def verdict(gate: str | None) -> Quality:
        return Quality(gate is None, gate, loud, snr, clip_share)

    if loud < profile.gate_min_loud_dbfs:
        return verdict(TOO_QUIET)
    if clip_share > profile.gate_max_clip_share:
        return verdict(CLIPPING)
    if snr < profile.gate_min_snr_db:
        return verdict(TOO_NOISY)
    return verdict(None)


TRIM_PAD_MS = 150
TRIM_BELOW_SPEECH_DB = (
    30.0  # frames quieter than (speech level - 30 dB) are leading/trailing silence
)


def speech_bounds(
    samples: Sequence[float], sample_rate: int, pad_ms: int = TRIM_PAD_MS
) -> tuple[int, int]:
    """[start, end) sample indexes of the read with ``pad_ms`` of context either side. The read is the span of
    frames within 30 dB of the 90th-percentile frame level; a clip with no such span is returned whole. Both
    runtimes trim before inference (less to compute) and the attempt's duration is the trimmed length, so the
    clip a spot-check uploads is exactly the clip that was scored."""
    frame = sample_rate * FRAME_MS // 1000
    powers = _frame_powers(samples, frame)
    if not powers:
        return 0, len(samples)
    db = [_dbfs(p) for p in powers]
    threshold = _percentile(sorted(db), SPEECH_PERCENTILE) - TRIM_BELOW_SPEECH_DB
    voiced = [i for i, v in enumerate(db) if v >= threshold]
    if not voiced:
        return 0, len(samples)
    pad = sample_rate * pad_ms // 1000
    return max(0, voiced[0] * frame - pad), min(len(samples), (voiced[-1] + 1) * frame + pad)


def expected_speech_ms(word_count: int, difficulty: int) -> float:
    """How long the twister takes at the reference pace for its level."""
    return 60_000 * word_count / REFERENCE_WPM.get(difficulty, REFERENCE_WPM[2])


def _entropy(row: Sequence[float]) -> float:
    probs = [math.exp(v) for v in row]
    total = math.fsum(probs)
    if total <= 0:
        return 0.0
    return -math.fsum((p / total) * math.log(p / total) for p in probs if p > 0)


def posterior_gate(
    post: Posteriors,
    expected_ms: float,
    profile: ScoringProfile | None = None,
) -> Quality:
    """``expected_ms``: how long the read should take (``expected_speech_ms``)."""
    profile = profile or ScoringProfile()
    voiced = []
    for t, row in enumerate(post.logp):
        best = 0
        for q in range(1, len(row)):
            if row[q] > row[best]:
                best = q
        if best != 0:
            voiced.append(t)
    if not voiced:
        return Quality(False, TOO_SHORT, speech_share=0.0)
    span_ms = (voiced[-1] - voiced[0] + 1) * FRAME_MS
    share = span_ms / expected_ms if expected_ms > 0 else 1.0
    if share < profile.gate_min_speech_share:
        return Quality(False, TOO_SHORT, speech_share=share)
    window = post.logp[voiced[0] : voiced[-1] + 1]
    confused = sum(1 for row in window if _entropy(row) > profile.gate_max_entropy)
    entropy_share = confused / len(window)
    if entropy_share > profile.gate_entropy_share:
        return Quality(False, BACKGROUND_SOUND, speech_share=share, entropy_share=entropy_share)
    return Quality(True, None, speech_share=share, entropy_share=entropy_share)
