"""16 kHz mono PCM WAV for later pronunciation analysis."""

from __future__ import annotations

from pathlib import Path

from ..context import JobContext
from ..ffmpeg import audio_argv


def run(ctx: JobContext, src: Path, dst: Path) -> None:
    ctx.run(audio_argv(src, dst, max_s=ctx.limits.max_s, threads=ctx.settings.ffmpeg_threads))
