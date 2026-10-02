"""FFmpeg/ffprobe: pure argv builders, a probe parser, and a runner with timeout + cancellation.

Builders never touch the filesystem or the network, so they are unit-tested by asserting argv."""

from __future__ import annotations

import json
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from .errors import Cancelled, JobFailed
from .models import Limits

FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"
LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11"
THUMB_MAX_HEIGHT = 720
THUMB_POSITION = 0.25
_QUIET = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error"]


@dataclass(frozen=True)
class ProbeInfo:
    duration_s: float | None
    width: int | None
    height: int | None
    video_codec: str | None
    has_audio: bool
    container: str
    audio_codec: str | None = None

    @property
    def duration_ms(self) -> int | None:
        return None if self.duration_s is None else round(self.duration_s * 1000)


def probe_argv(src: Path) -> list[str]:
    return [
        FFPROBE,
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        str(src),
    ]


def parse_probe(raw: str) -> ProbeInfo:
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise JobFailed("probe_failed", "ffprobe output is not JSON") from exc
    streams = data.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fmt = data.get("format") or {}
    if video is None:
        raise JobFailed("no_video_stream", "source has no video stream")
    return ProbeInfo(
        duration_s=_positive_float(fmt.get("duration")) or _positive_float(video.get("duration")),
        width=_int_or_none(video.get("width")),
        height=_int_or_none(video.get("height")),
        video_codec=video.get("codec_name"),
        has_audio=audio is not None,
        audio_codec=audio.get("codec_name") if audio else None,
        container=str(fmt.get("format_name") or ""),
    )


def can_copy_video(info: ProbeInfo, max_height: int) -> bool:
    """True when the source is already an H.264 MP4 within the height cap: skip the video re-encode."""
    return (
        "mp4" in info.container.split(",")
        and info.video_codec == "h264"
        and info.height is not None
        and info.height <= max_height
    )


def needs_transcode(info: ProbeInfo, limits: Limits) -> bool:
    """False when the upload is already a playable H.264/AAC MP4 within the caps: the original is
    served as-is and no derived MP4 is produced."""
    return not (
        can_copy_video(info, limits.max_height)
        and info.audio_codec in (None, "aac")
        and info.duration_s is not None
        and info.duration_s <= limits.max_s
    )


def _scale_filter(max_height: int) -> str:
    # -2 keeps the aspect ratio with an even width; the height is floored to even as well.
    return f"scale=w=-2:h='min(trunc(ih/2)*2,{max_height})'"


def transcode_argv(
    src: Path, dst: Path, *, info: ProbeInfo, max_height: int, max_s: int, threads: int
) -> list[str]:
    video = (
        ["-c:v", "copy"]
        if can_copy_video(info, max_height)
        else [
            "-vf", _scale_filter(max_height),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
        ]
    )  # fmt: skip
    return [
        FFMPEG, *_QUIET, "-fflags", "+genpts", "-i", str(src), "-t", str(max_s),
        "-map", "0:v:0", "-map", "0:a:0?", *video,
        "-af", LOUDNORM, "-c:a", "aac", "-b:a", "128k",
        "-threads", str(threads), "-movflags", "+faststart", "-f", "mp4", str(dst),
    ]  # fmt: skip


def thumbnail_argv(src: Path, dst: Path, *, at_s: float) -> list[str]:
    return [
        FFMPEG, *_QUIET, "-ss", f"{max(at_s, 0):.3f}", "-i", str(src), "-frames:v", "1", "-an",
        "-vf", f"scale=w=-2:h='min(trunc(ih/2)*2,{THUMB_MAX_HEIGHT})'",
        "-q:v", "3", "-update", "1", "-f", "image2", str(dst),
    ]  # fmt: skip


def thumbnail_position_s(duration_s: float | None) -> float:
    """25 % into the clip; unknown durations fall back to the first frame."""
    return 0.0 if not duration_s else duration_s * THUMB_POSITION


def audio_argv(src: Path, dst: Path, *, max_s: int, threads: int) -> list[str]:
    return [
        FFMPEG, *_QUIET, "-i", str(src), "-t", str(max_s), "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", "-threads", str(threads), "-f", "wav", str(dst),
    ]  # fmt: skip


def pcm_f32_argv(src: Path, dst: Path, *, max_s: int, threads: int) -> list[str]:
    """Any audio/video container -> raw 16 kHz mono float32 little-endian (the scoring model's input)."""
    return [
        FFMPEG, *_QUIET, "-i", str(src), "-t", str(max_s), "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_f32le", "-threads", str(threads), "-f", "f32le", str(dst),
    ]  # fmt: skip


@dataclass(frozen=True)
class CommandResult:
    stdout: str
    stderr: str


def run_command(
    argv: list[str], *, timeout_s: float, cancel: threading.Event | None = None
) -> CommandResult:
    """Run `argv` with a hard timeout, killing it on timeout or cancellation."""
    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
    except OSError as exc:
        raise JobFailed("ffmpeg_missing", f"cannot start {argv[0]}") from exc
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            stdout, stderr = proc.communicate(timeout=0.25)
            break
        except subprocess.TimeoutExpired:
            if cancel is not None and cancel.is_set():
                _kill(proc)
                raise Cancelled("cancelled") from None
            if time.monotonic() >= deadline:
                _kill(proc)
                raise JobFailed("ffmpeg_timeout", f"{argv[0]} exceeded its time budget") from None
    if proc.returncode != 0:
        tail = (stderr or "").strip()[-400:]
        raise JobFailed("ffmpeg_failed", f"{argv[0]} exited {proc.returncode}: {tail}")
    return CommandResult(stdout or "", stderr or "")


def _kill(proc: subprocess.Popen[str]) -> None:
    proc.kill()
    proc.communicate()


def _positive_float(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if number > 0 and number != float("inf") else None


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) and value > 0 else None
