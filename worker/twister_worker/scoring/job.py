"""Typed, strictly validated view of a scoring-job claim payload (API: `speak/jobs.py::build_payload`).
Anything the worker acts on is checked; a payload that fails here is a permanent `job_invalid`."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from ..engine.types import Word
from ..errors import JobFailed

_SHA = re.compile(r"^[0-9a-f]{64}$")
_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_WORDS = 600
#: `record` scores a recording's whole analysis audio (trimmed here) and returns full verdicts.
KINDS = ("spot_check", "verify", "record")


@dataclass(frozen=True)
class AudioRef:
    url: str = field(repr=False)
    size_bytes: int
    mime: str
    sha256: str | None


@dataclass(frozen=True)
class ModelRef:
    name: str
    sha256: str
    url: str = field(repr=False)
    size_bytes: int
    label_map_version: str
    label_map_url: str = field(repr=False)


@dataclass(frozen=True)
class ScoringJob:
    id: str
    kind: str
    lease_s: int
    max_audio_s: int
    attempt_id: str
    duration_ms: int
    device_score: float | None
    attempt_audio_sha256: str | None
    difficulty: int
    audio: AudioRef
    model: ModelRef
    profile_code: str
    thresholds: dict[str, Any]
    focus: frozenset[str]
    words: list[Word]

    @classmethod
    def from_payload(cls, data: Any) -> ScoringJob:
        try:
            return cls._parse(data)
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise JobFailed("job_invalid", f"malformed scoring job: {type(exc).__name__}") from exc

    @classmethod
    def _parse(cls, data: Any) -> ScoringJob:
        if not isinstance(data, dict):
            raise TypeError("payload is not an object")
        job_id = _text(data["id"], _ID)
        attempt, audio, model = data["attempt"], data["audio"], data["model"]
        twister, profile = data["twister"], data.get("profile") or {}
        words = [_word(w) for w in twister["words"]]
        if not words or len(words) > MAX_WORDS:
            raise ValueError("word count out of range")
        thresholds = profile.get("thresholds") or {}
        if not isinstance(thresholds, dict):
            raise TypeError("thresholds")
        audio_sha = audio.get("sha256")
        attempt_sha = attempt.get("audio_sha256")
        kind = str(data.get("kind", "spot_check"))
        if kind not in KINDS:
            raise ValueError("kind")
        return cls(
            id=job_id,
            kind=kind,
            lease_s=_int(data["lease_s"], 5, 3600),
            max_audio_s=_int(data["max_audio_s"], 1, 600),
            attempt_id=_text(attempt["id"], _ID),
            duration_ms=_int(attempt["duration_ms"], 1, 3_600_000),
            device_score=_number_or_none(attempt.get("device_score")),
            attempt_audio_sha256=_sha_or_none(attempt_sha),
            difficulty=_int(attempt.get("difficulty", 2), 1, 4),
            audio=AudioRef(
                url=_url(audio["url"]),
                size_bytes=_int(audio["size_bytes"], 1, 1 << 31),
                mime=str(audio.get("mime", ""))[:80],
                sha256=_sha_or_none(audio_sha),
            ),
            model=ModelRef(
                name=str(model["name"])[:120],
                sha256=_text(model["sha256"], _SHA),
                url=_url(model["url"]),
                size_bytes=_int(model["size_bytes"], 1, 1 << 33),
                label_map_version=str(model["label_map_version"])[:60],
                label_map_url=_url(model["label_map_url"]),
            ),
            profile_code=str(profile.get("code", ""))[:60],
            thresholds=thresholds,
            focus=frozenset(str(f).upper() for f in twister.get("focus", [])),
            words=words,
        )


def _word(raw: Any) -> Word:
    text = raw["text"]
    variants = raw["variants"]
    if not isinstance(text, str) or not text or not isinstance(variants, list) or not variants:
        raise ValueError("word")
    clean = []
    for variant in variants:
        if (
            not isinstance(variant, list)
            or not variant
            or not all(isinstance(p, str) for p in variant)
        ):
            raise ValueError("variant")
        clean.append(list(variant))
    return Word(text, clean)


def _text(value: Any, pattern: re.Pattern[str]) -> str:
    if not isinstance(value, str) or not pattern.match(value):
        raise ValueError("bad identifier")
    return value


def _sha_or_none(value: Any) -> str | None:
    if value in (None, ""):
        return None
    return _text(str(value).lower(), _SHA)


def _int(value: Any, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise ValueError("integer out of range")
    return value


def _number_or_none(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise TypeError("number")
    return float(value)


def _url(value: Any) -> str:
    if not isinstance(value, str) or not value.startswith(("https://", "http://")):
        raise ValueError("url")
    return value
