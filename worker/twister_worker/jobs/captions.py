"""WebVTT from the attempt's word timings: the *target* text, timed by the recognised words.

`build_vtt` is pure. Rules:
- words with no text are dropped; text is whitespace-collapsed and VTT-escaped
- a word missing one or both timings is interpolated between its timed neighbours
  (no timed word at all -> no captions)
- zero/negative-length words get a minimum duration; overlaps are trimmed to the next start
- cues break at <= MAX_WORDS words, <= MAX_CUE_MS, a gap >= GAP_MS, or sentence punctuation
- everything is clamped into [0, duration_ms] when the duration is known
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from ..models import Word

MAX_WORDS = 7
MAX_CUE_MS = 3500
GAP_MS = 1000
MIN_WORD_MS = 120
_SENTENCE_END = re.compile(r"[.!?…]$")


@dataclass(frozen=True)
class _Timed:
    text: str
    start: int
    end: int


def escape_cue_text(text: str) -> str:
    collapsed = " ".join(text.split())
    return (
        collapsed.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("-->", "--&gt;")
    )


def format_timestamp(ms: int) -> str:
    ms = max(0, ms)
    hours, rest = divmod(ms, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    seconds, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def _interpolate(words: list[Word]) -> list[tuple[str, int, int]] | None:
    """Fill missing timings. Returns (text, start, end) per word or None if nothing is timed."""
    starts: list[int | None] = [w.start_ms for w in words]
    ends: list[int | None] = [w.end_ms for w in words]
    # A word with only one timing borrows it for the other side (then gets MIN_WORD_MS).
    for i in range(len(words)):
        if starts[i] is None and ends[i] is not None:
            starts[i] = ends[i]
        elif ends[i] is None and starts[i] is not None:
            ends[i] = starts[i]
    timed = [i for i in range(len(words)) if starts[i] is not None]
    if not timed:
        return None
    result: list[tuple[str, int, int]] = []
    i = 0
    while i < len(words):
        if starts[i] is not None:
            result.append((words[i].target, starts[i], ends[i]))  # type: ignore[arg-type]
            i += 1
            continue
        j = i
        while j < len(words) and starts[j] is None:
            j += 1
        left = ends[i - 1] if i > 0 else None
        right = starts[j] if j < len(words) else None
        count = j - i
        lo = left if left is not None else (right - count * 300 if right is not None else 0)
        hi = right if right is not None else lo + count * 300
        lo, hi = max(0, lo), max(hi, max(0, lo))
        step = (hi - lo) / count
        for k in range(count):
            result.append((words[i + k].target, round(lo + k * step), round(lo + (k + 1) * step)))
        i = j
    return result


def _normalise(words: list[Word], duration_ms: int | None) -> list[_Timed]:
    usable = [w for w in words if " ".join(w.target.split())]
    filled = _interpolate(usable)
    if filled is None:
        return []
    cap = duration_ms if duration_ms and duration_ms > 0 else None
    out: list[_Timed] = []
    previous_start = 0
    for text, start, end in filled:
        start = max(start, previous_start if out else 0)
        if cap is not None:
            start = min(start, cap)
        end = max(end, start + MIN_WORD_MS)
        if cap is not None:
            end = min(end, cap)
        if end <= start:
            continue  # nothing left to show inside the clip
        out.append(_Timed(text, start, end))
        previous_start = start  # overlaps are resolved against the *next* start below
    for k in range(len(out) - 1):
        if out[k].end > out[k + 1].start:
            trimmed = max(out[k + 1].start, out[k].start + 1)
            out[k] = _Timed(out[k].text, out[k].start, trimmed)
    return out


def _group(words: list[_Timed]) -> list[list[_Timed]]:
    cues: list[list[_Timed]] = []
    current: list[_Timed] = []
    for word in words:
        if current and (
            len(current) >= MAX_WORDS
            or word.end - current[0].start > MAX_CUE_MS
            or word.start - current[-1].end >= GAP_MS
            or _SENTENCE_END.search(current[-1].text)
        ):
            cues.append(current)
            current = []
        current.append(word)
    if current:
        cues.append(current)
    return cues


def build_vtt(words: list[Word] | None, duration_ms: int | None = None) -> str | None:
    """WebVTT document, or None when there is nothing usable to caption."""
    if not words:
        return None
    timed = _normalise(words, duration_ms)
    if not timed:
        return None
    lines = ["WEBVTT", ""]
    for cue in _group(timed):
        start, end = cue[0].start, max(w.end for w in cue)
        lines.append(f"{format_timestamp(start)} --> {format_timestamp(end)}")
        lines.append(escape_cue_text(" ".join(w.text for w in cue)))
        lines.append("")
    return "\n".join(lines)


def run(words: list[Word] | None, duration_ms: int | None, dst: Path) -> bool:
    """Write the VTT file. False (and no file) when no captions can be produced."""
    vtt = build_vtt(words, duration_ms)
    if vtt is None:
        return False
    dst.write_text(vtt, encoding="utf-8")
    return True
