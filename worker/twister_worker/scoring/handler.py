"""One spot-check, start to finish: download -> verify -> decode -> quality gate -> model -> engine -> verdict.

Returns the body for `POST /internal/scoring-jobs/{id}/result/`. Inconclusive clips are reported as
`done` + `unscorable` (the device result stands); only genuine worker trouble is `failed`."""

from __future__ import annotations

import hashlib
import logging
import math
import time
from dataclasses import fields
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx

from .. import transfer
from ..context import JobContext
from ..engine import Posteriors, ScoringProfile, assess, quality
from ..engine.types import FRAME_MS, Assessment, PhonemeResult, WordResult
from ..logging_setup import log
from ..pipeline import workdir
from . import audio
from .job import ScoringJob
from .model import ModelStore, check_url

logger = logging.getLogger(__name__)

DURATION_TOLERANCE = 0.10  # same rule the API applied when the clip was attached (D38)
# A record job's audio is the whole take extracted from the video, whose recorded length is only approximate
# (webm durations are unreliable): a coarse sanity check, not a tamper check (the worker made the audio).
RECORD_TOLERANCE = 0.25
RECORD_TOLERANCE_FLOOR_MS = 2000
MIN_SCORED_SAMPLES = 400  # 25 ms: less than this after trimming is not speech
INCONCLUSIVE = {
    "no_speech",
    "nothing_recognised",
    "could_not_follow",
    "audio_mismatch",
    "audio_too_long",
    "audio_unreadable",
    "low_quality",
    "model_mismatch",
}


@lru_cache(maxsize=1)
def engine_version() -> str:
    manifest = Path(__file__).resolve().parent.parent / "engine" / "VENDORED.json"
    try:
        return "e-" + hashlib.sha256(manifest.read_bytes()).hexdigest()[:10]
    except OSError:
        return "e-unknown"


def build_profile(job: ScoringJob) -> ScoringProfile:
    """Thresholds from the active scoring profile; unknown or malformed keys are ignored, never trusted."""
    kinds = {f.name: f.type for f in fields(ScoringProfile)}
    accepted: dict[str, Any] = {"name": job.profile_code or ScoringProfile.name}
    for key, value in job.thresholds.items():
        want = kinds.get(key)
        if (
            want is None
            or key == "name"
            or isinstance(value, bool)
            or not isinstance(value, int | float)
        ):
            continue
        if not math.isfinite(value):
            continue
        accepted[key] = int(value) if want in ("int", int) else float(value)
    return ScoringProfile(**accepted)


def handle(
    job: ScoringJob, ctx: JobContext, http: httpx.Client, store: ModelStore
) -> dict[str, Any]:
    started = time.monotonic()
    ctx.check()
    settings = ctx.settings
    check_url(
        job.audio.url,
        allowed_hosts=settings.allowed_download_hosts,
        api_base_url=settings.api_base_url,
    )
    with workdir(settings.work_dir) as tmp:
        clip = tmp / "clip"
        cap = min(job.audio.size_bytes, settings.max_scoring_audio_bytes)
        if job.audio.size_bytes > settings.max_scoring_audio_bytes:
            return _inconclusive(job, "audio_too_long", started)
        transfer.download(
            http,
            job.audio.url,
            clip,
            max_bytes=cap,
            timeout_s=settings.transfer_timeout_s,
            attempts=settings.retry_attempts,
            cancel=ctx.cancel,
        )
        ctx.check()
        if not _clip_matches(job, clip):
            return _inconclusive(job, "audio_mismatch", started)
        samples = audio.decode(ctx, clip, tmp / "clip.f32", max_s=job.max_audio_s)
    measured_ms = round(samples.size / audio.SAMPLE_RATE * 1000)
    record = job.kind == "record"
    if samples.size / audio.SAMPLE_RATE > job.max_audio_s:
        return _inconclusive(job, "audio_too_long", started, {"duration_ms": measured_ms})
    if record:
        slack = max(RECORD_TOLERANCE * job.duration_ms, RECORD_TOLERANCE_FLOOR_MS)
    else:
        slack = DURATION_TOLERANCE * max(job.duration_ms, 1000)
    if abs(measured_ms - job.duration_ms) > slack:
        return _inconclusive(job, "audio_mismatch", started, {"duration_ms": measured_ms})
    profile = build_profile(job)
    signal = quality.signal_gate(samples.tolist(), audio.SAMPLE_RATE, profile)
    if not signal.ok:
        details = audio.gate_details(signal, measured_ms)
        return _inconclusive(job, audio.unscorable_for(signal), started, details)
    if record:
        # The device trims before scoring and reports the trimmed length; a record take is the whole video's
        # audio, so it gets the same treatment (spec 13 section 3.7): less to compute, and speed/fluency are
        # judged on the read itself, not on the countdown and the reach for the stop button.
        begin, end = quality.speech_bounds(samples.tolist(), audio.SAMPLE_RATE)
        samples = samples[begin:end]
        if samples.size < MIN_SCORED_SAMPLES:
            return _inconclusive(job, "no_speech", started, audio.gate_details(signal, measured_ms))
        measured_ms = round(samples.size / audio.SAMPLE_RATE * 1000)

    ctx.check()
    model = store.get(job.model, ctx, http)
    ctx.check()
    logits = model.logits(audio.normalise(samples))
    post = Posteriors(vocab=model.labels.classes, logp=model.labels.collapse(logits).tolist())
    expected_ms = quality.expected_speech_ms(len(job.words), job.difficulty)
    gate = quality.posterior_gate(post, expected_ms, profile)
    details = audio.gate_details(signal, measured_ms) | audio.gate_details(gate, measured_ms)
    if not gate.ok:
        return _inconclusive(job, audio.unscorable_for(gate), started, details)
    result = assess(
        post,
        job.words,
        focus=job.focus,
        profile=profile,
        duration_ms=measured_ms if record else job.duration_ms,
        difficulty=job.difficulty,
    )
    log(
        logger,
        logging.INFO,
        "job_scored",
        job_id=job.id,
        unscorable=result.unscorable or "",
        frames=post.frames,
    )
    return _body(job, result, details, started, scored_ms=measured_ms if record else None)


def _clip_matches(job: ScoringJob, path: Path) -> bool:
    size = path.stat().st_size
    if size != job.audio.size_bytes:
        return False
    expected = {h for h in (job.audio.sha256, job.attempt_audio_sha256) if h}
    if not expected:
        # A spot-check clip came from the browser and must be provably the scored one. A record job's audio is
        # this system's own extraction (no claimed hash exists), so the size check above is what applies.
        return job.kind == "record"
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return expected == {digest.hexdigest()}  # the asset's and the attempt's hashes must both match


def _latency(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _inconclusive(
    job: ScoringJob, reason: str, started: float, quality: dict[str, object] | None = None
) -> dict[str, Any]:
    log(logger, logging.INFO, "job_inconclusive", job_id=job.id, reason=reason)
    return {
        "status": "done",
        "unscorable": reason,
        "score": None,
        "words": [],
        "model_sha256": job.model.sha256,
        "engine_version": engine_version(),
        "quality": quality or {},
        "latency_ms": _latency(started),
    }


def _finite(value: float | None, places: int = 3) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, places)


def _ms(frame: int) -> int:
    return max(0, min(600_000, round(frame * FRAME_MS)))


def _phoneme(p: PhonemeResult) -> dict[str, Any]:
    out: dict[str, Any] = {"t": p.target[:8], "verdict": p.verdict}
    if p.heard:
        out["heard"] = p.heard[:8]
    for key, value in (("delta", p.delta), ("lpp", p.lpp), ("lpr", p.lpr)):
        rounded = _finite(value)
        if rounded is not None:
            out[key] = rounded
    out["start_ms"], out["end_ms"] = _ms(p.start), _ms(p.end)
    return out


def _full_word(w: WordResult) -> dict[str, Any]:
    """The same shape the browser sends for an on-device attempt (the API validates it identically)."""
    out: dict[str, Any] = {"i": w.index, "target": w.text[:64], "status": w.status}
    if w.reason:
        out["reason"] = w.reason
    out["start_ms"], out["end_ms"] = _ms(w.start), _ms(w.end)
    out["phonemes"] = [_phoneme(p) for p in w.phonemes]
    return out


def _body(
    job: ScoringJob,
    result: Assessment,
    quality: dict[str, object],
    started: float,
    scored_ms: int | None = None,
) -> dict[str, Any]:
    if result.unscorable:
        reason = result.unscorable if result.unscorable in INCONCLUSIVE else "could_not_follow"
        return _inconclusive(job, reason, started, quality)
    body: dict[str, Any] = {
        "status": "done",
        "score": result.score,
        "words": [{"i": w.index, "status": w.status, "reason": w.reason} for w in result.words],
        "model_sha256": job.model.sha256,
        "engine_version": engine_version(),
        "quality": quality,
        "latency_ms": _latency(started),
    }
    if job.kind == "record":
        # 'extra' is a count, not a word of the twister: the API only accepts verdicts for expected words.
        body["words"] = [_full_word(w) for w in result.words if w.status != "extra"]
        body["duration_ms"] = scored_ms
    return body
