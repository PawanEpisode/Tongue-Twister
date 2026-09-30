"""Typed view of the claim payload (build spec A2.2). Parsing is strict about what the worker acts
on (ids, URLs, sizes, output slots) and lenient about optional extras."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from .errors import JobFailed

KINDS = ("process", "analyse")
OUTPUT_NAMES = ("mp4", "thumbnail", "captions", "audio")
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


@dataclass(frozen=True)
class Source:
    url: str = field(repr=False)
    mime: str
    size_bytes: int


@dataclass(frozen=True)
class OutputTarget:
    path: str
    upload_url: str = field(repr=False)
    token: str = field(repr=False)
    mime: str


@dataclass(frozen=True)
class Word:
    target: str
    start_ms: int | None
    end_ms: int | None
    status: str = ""


@dataclass(frozen=True)
class Limits:
    max_height: int
    max_s: int
    max_output_bytes: int | None = None


@dataclass(frozen=True)
class Job:
    id: str
    kind: str
    recording_id: str
    asset_id: str
    lease_s: int
    source: Source
    outputs: dict[str, OutputTarget]
    words: list[Word] | None
    limits: Limits

    @classmethod
    def from_payload(cls, data: dict[str, Any]) -> Job:
        try:
            return cls._parse(data)
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise JobFailed("job_invalid", f"malformed job payload: {type(exc).__name__}") from exc

    @classmethod
    def _parse(cls, data: dict[str, Any]) -> Job:
        kind = str(data["kind"])
        if kind not in KINDS:
            raise ValueError("kind")
        job_id, asset_id = str(data["id"]), str(data["asset_id"])
        if not _SAFE_ID.match(job_id) or not _SAFE_ID.match(asset_id):
            raise ValueError("id")
        src = data["source"]
        if not str(src["url"]).startswith(("https://", "http://")):
            raise ValueError("source url")
        lim = data["limits"]
        max_out = lim.get("max_output_bytes")
        outputs = {
            name: OutputTarget(
                path=str(spec["path"]),
                upload_url=str(spec["upload_url"]),
                token=str(spec.get("token") or ""),
                mime=str(spec["mime"]),
            )
            for name, spec in (data.get("outputs") or {}).items()
            if name in OUTPUT_NAMES and spec
        }
        raw_words = data.get("words")
        return cls(
            id=job_id,
            kind=kind,
            recording_id=str(data["recording_id"]),
            asset_id=asset_id,
            lease_s=max(1, int(data.get("lease_s", 60))),
            source=Source(
                url=str(src["url"]), mime=str(src["mime"]), size_bytes=int(src["size_bytes"])
            ),
            outputs=outputs,
            words=None if raw_words is None else [_word(w) for w in raw_words],
            limits=Limits(
                max_height=int(lim["max_height"]),
                max_s=int(lim["max_s"]),
                max_output_bytes=None if max_out is None else int(max_out),
            ),
        )


def _word(raw: dict[str, Any]) -> Word:
    return Word(
        target=str(raw.get("target") or ""),
        start_ms=_ms(raw.get("start_ms")),
        end_ms=_ms(raw.get("end_ms")),
        status=str(raw.get("status") or ""),
    )


def _ms(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    number = float(value)
    return int(number) if number >= 0 and number == number else None
