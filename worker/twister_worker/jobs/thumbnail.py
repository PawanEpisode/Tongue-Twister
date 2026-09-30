"""JPEG poster frame at 25 % of the clip (first frame when the duration is unknown)."""

from __future__ import annotations

from pathlib import Path

from ..context import JobContext
from ..errors import JobFailed
from ..ffmpeg import ProbeInfo, thumbnail_argv, thumbnail_position_s


def run(ctx: JobContext, src: Path, dst: Path, info: ProbeInfo) -> None:
    at_s = thumbnail_position_s(info.duration_s)
    ctx.run(thumbnail_argv(src, dst, at_s=at_s))
    if (not dst.exists() or dst.stat().st_size == 0) and at_s > 0:
        # Seeking past the last decodable frame yields no output: retry from the start.
        ctx.run(thumbnail_argv(src, dst, at_s=0.0))
    if not dst.exists() or dst.stat().st_size == 0:
        raise JobFailed("thumbnail_failed", "no frame extracted")
