"""H.264/AAC MP4 (faststart, <= max_height, loudness-normalised). Video is stream-copied when the
source is already an H.264 MP4 within the height cap; audio is always normalised."""

from __future__ import annotations

from pathlib import Path

from ..context import JobContext
from ..ffmpeg import ProbeInfo, transcode_argv


def run(ctx: JobContext, src: Path, dst: Path, info: ProbeInfo) -> None:
    ctx.run(
        transcode_argv(
            src,
            dst,
            info=info,
            max_height=ctx.limits.max_height,
            max_s=ctx.limits.max_s,
            threads=ctx.settings.ffmpeg_threads,
        )
    )
