"""The gold-set format: one JSON clip per recorded read, with its frame posteriors stored (docs/features/10 §7).

A clip records everything the scorer needs, so a read can be re-scored offline in milliseconds and thresholds tuned
without the model or the audio: the expected words (with the accent's variants), the focus sounds, the frame
log-posteriors (float16, base64) and what the speaker was *scripted* to do. Labels are known by construction.

Files are either one clip per ``*.json`` or a bundle ``{"clips": [...]}`` as exported by `/dev/calibrate`.
"""

from __future__ import annotations

import base64
import json
import math
import struct
from dataclasses import dataclass, field
from pathlib import Path

SCHEMA = 1
SCENARIOS = ("clean", "fast", "swap", "slur")
ACCENTS = ("en-US", "en-GB", "en-IN", "en-AU")
AGE_BANDS = ("13-17", "18-24", "25-34", "35-49", "50+")
DEVICE_CLASSES = ("laptop", "desktop", "phone", "tablet", "unknown")


class GoldError(ValueError):
    """A clip file that cannot be used; the message says which clip and why."""


def encode_posteriors(logp: list[list[float]]) -> str:
    """Rows of log-probabilities -> base64 of little-endian float16 (T x V, row-major)."""
    flat = [x for row in logp for x in row]
    clipped = [max(-60.0, min(0.0, x)) for x in flat]  # float16 holds ~±65504; log-probs never need more than -60
    return base64.b64encode(struct.pack(f"<{len(clipped)}e", *clipped)).decode("ascii")


def decode_posteriors(blob: str, frames: int, vocab: int) -> list[list[float]]:
    raw = base64.b64decode(blob, validate=True)
    if len(raw) != frames * vocab * 2:
        raise GoldError(f"posteriors hold {len(raw) // 2} values, expected {frames}x{vocab}")
    flat = struct.unpack(f"<{frames * vocab}e", raw)
    return [list(flat[t * vocab : (t + 1) * vocab]) for t in range(frames)]


@dataclass(frozen=True)
class Speaker:
    id: str
    accent: str
    age_band: str
    native: bool
    device_class: str = "unknown"


@dataclass(frozen=True)
class Clip:
    id: str
    speaker: Speaker
    scenario: str
    slug: str
    words: list[tuple[str, list[list[str]]]]
    focus: list[str]
    difficulty: int
    vocab: tuple[str, ...]
    logp: list[list[float]]
    #: word index the speaker was scripted to say wrongly (scenario "swap"), else None
    swap_word: int | None = None
    duration_ms: int = 0
    latency_ms: int | None = None
    synthetic: bool = False
    extra: dict = field(default_factory=dict)

    @property
    def clean(self) -> bool:
        """Said correctly by construction: any accusation is a false one."""
        return self.scenario in ("clean", "fast")


def _need(d: dict, key: str, kind, where: str):
    if key not in d or not isinstance(d[key], kind) or isinstance(d[key], bool) and kind is not bool:
        raise GoldError(f"{where}: '{key}' is missing or not a {kind.__name__}")
    return d[key]


def parse_clip(d: dict, where: str = "clip") -> Clip:
    if d.get("schema") != SCHEMA:
        raise GoldError(f"{where}: unsupported schema {d.get('schema')!r}")
    cid = _need(d, "id", str, where)
    where = f"clip {cid}"
    sp = _need(d, "speaker", dict, where)
    speaker = Speaker(
        id=_need(sp, "id", str, where),
        accent=_need(sp, "accent", str, where),
        age_band=_need(sp, "age_band", str, where),
        native=_need(sp, "native", bool, where),
        device_class=sp.get("device_class", "unknown"),
    )
    if speaker.accent not in ACCENTS:
        raise GoldError(f"{where}: unknown accent {speaker.accent!r}")
    if speaker.age_band not in AGE_BANDS:
        raise GoldError(f"{where}: unknown age band {speaker.age_band!r}")
    if speaker.device_class not in DEVICE_CLASSES:
        raise GoldError(f"{where}: unknown device class {speaker.device_class!r}")
    if d.get("consent") is not True:
        raise GoldError(f"{where}: no recorded consent from the speaker")
    scenario = _need(d, "scenario", str, where)
    if scenario not in SCENARIOS:
        raise GoldError(f"{where}: unknown scenario {scenario!r}")
    tw = _need(d, "twister", dict, where)
    words_raw = _need(tw, "words", list, where)
    words = []
    for i, w in enumerate(words_raw):
        variants = w.get("variants") if isinstance(w, dict) else None
        if not isinstance(w.get("text"), str) or not variants or not all(isinstance(v, list) and v for v in variants):
            raise GoldError(f"{where}: word {i} has no usable pronunciation")
        words.append((w["text"], [list(map(str, v)) for v in variants]))
    if not words:
        raise GoldError(f"{where}: no words")
    swap = d.get("swap_word")
    if scenario == "swap":
        if not isinstance(swap, int) or isinstance(swap, bool) or not 0 <= swap < len(words):
            raise GoldError(f"{where}: a swap clip needs 'swap_word' within the twister")
    elif swap is not None:
        raise GoldError(f"{where}: only swap clips carry 'swap_word'")
    post = _need(d, "posteriors", dict, where)
    vocab = tuple(_need(post, "vocab", list, where))
    frames = _need(post, "frames", int, where)
    if not vocab or vocab[0] != "<b>" or len(set(vocab)) != len(vocab):
        raise GoldError(f"{where}: vocab must start with the blank '<b>' and be unique")
    if frames < 1:
        raise GoldError(f"{where}: no frames")
    logp = decode_posteriors(_need(post, "logp_f16", str, where), frames, len(vocab))
    if any(math.isnan(x) for row in logp for x in row):
        raise GoldError(f"{where}: posteriors contain NaN")
    latency = d.get("latency_ms")
    return Clip(
        id=cid,
        speaker=speaker,
        scenario=scenario,
        slug=tw.get("slug", ""),
        words=words,
        focus=list(tw.get("focus", [])),
        difficulty=int(tw.get("difficulty", 2)),
        vocab=vocab,
        logp=logp,
        swap_word=swap,
        duration_ms=int(d.get("duration_ms", frames * 20)),
        latency_ms=int(latency) if isinstance(latency, int | float) and not isinstance(latency, bool) else None,
        synthetic=bool(d.get("synthetic", False)),
        extra={k: d[k] for k in ("model", "quality") if k in d},
    )


def load(path: str | Path) -> list[Clip]:
    """All clips under a directory (recursively) or from one file; duplicate ids are an error."""
    path = Path(path)
    files = sorted(path.rglob("*.json")) if path.is_dir() else [path]
    clips: list[Clip] = []
    for f in files:
        try:
            data = json.loads(f.read_text())
        except (OSError, ValueError) as exc:
            raise GoldError(f"{f}: {exc}") from exc
        items = data["clips"] if isinstance(data, dict) and "clips" in data else [data]
        for i, item in enumerate(items):
            if not isinstance(item, dict):
                raise GoldError(f"{f}[{i}]: not a clip")
            clips.append(parse_clip(item, f"{f.name}[{i}]"))
    seen: set[str] = set()
    for c in clips:
        if c.id in seen:
            raise GoldError(f"duplicate clip id {c.id}")
        seen.add(c.id)
    if not clips:
        raise GoldError(f"no clips found in {path}")
    return clips
