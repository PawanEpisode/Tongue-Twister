"""Decode the clip to 16 kHz mono float32 and decide whether it is worth scoring (doc 13 §3.5)."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from ..context import JobContext
from ..engine import quality
from ..errors import JobFailed
from ..ffmpeg import pcm_f32_argv

SAMPLE_RATE = 16_000


# Engine gate name -> the API's `unscorable` code. Every gate leaves the device result standing; the specific
# gate travels in the `quality` block for the dashboards.
GATE_CODES = {
    quality.TOO_SHORT: "no_speech",
    quality.TOO_QUIET: "low_quality",
    quality.TOO_NOISY: "low_quality",
    quality.CLIPPING: "low_quality",
    quality.LOW_SAMPLE_RATE: "low_quality",
    quality.BACKGROUND_SOUND: "low_quality",
}


def gate_details(result: quality.Quality, duration_ms: int) -> dict[str, object]:
    out: dict[str, object] = {"ok": result.ok, "gate": result.gate, "duration_ms": duration_ms}
    for key in ("loud_dbfs", "snr_db", "clip_share", "speech_share", "entropy_share"):
        value = getattr(result, key)
        if value is not None:
            out[key] = round(value, 4)
    return out


def unscorable_for(result: quality.Quality) -> str:
    return GATE_CODES.get(result.gate or "", "low_quality")


def decode(ctx: JobContext, src: Path, dst: Path, *, max_s: int) -> np.ndarray:
    """Whole clip as float32 samples in [-1, 1]. Anything ffmpeg cannot read is `audio_unreadable`; clips
    longer than the cap are rejected rather than truncated (a truncated read cannot match the transcript)."""
    try:
        ctx.run(pcm_f32_argv(src, dst, max_s=max_s + 1, threads=ctx.settings.ffmpeg_threads))
    except JobFailed as exc:
        if exc.code in ("ffmpeg_failed",):
            raise JobFailed("audio_unreadable", "ffmpeg could not decode the clip") from exc
        raise
    raw = dst.read_bytes() if dst.exists() else b""
    usable = len(raw) - len(raw) % 4
    samples = np.frombuffer(raw[:usable], dtype="<f4").astype(np.float32, copy=True)
    if samples.size == 0:
        raise JobFailed("audio_unreadable", "decoded clip is empty")
    if not np.isfinite(samples).all():
        samples = np.nan_to_num(samples, nan=0.0, posinf=0.0, neginf=0.0)
    return np.clip(samples, -1.0, 1.0)


def normalise(samples: np.ndarray) -> np.ndarray:
    """Zero mean, unit variance: what the exported wav2vec2 expects (`preprocess.normalize`)."""
    mean = float(samples.mean())
    std = float(samples.std())
    return ((samples - mean) / (std + 1e-7)).astype(np.float32)
