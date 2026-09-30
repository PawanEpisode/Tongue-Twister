"""One job, start to finish: download -> ffmpeg -> upload -> report payload. No network calls to the
API here (the runner reports), so the whole flow is testable with a fake HTTP transport."""

from __future__ import annotations

import logging
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import httpx

from . import transfer
from .context import JobContext
from .errors import Cancelled, JobFailed
from .ffmpeg import ProbeInfo, needs_transcode, parse_probe, probe_argv
from .jobs import audio, captions, thumbnail, transcode
from .logging_setup import log
from .models import Job, OutputTarget

logger = logging.getLogger(__name__)

# Output name -> (local file name, payload key prefix)
_FILES = {
    "mp4": "out.mp4",
    "thumbnail": "thumb.jpg",
    "captions": "captions.vtt",
    "audio": "audio.wav",
}


@contextmanager
def workdir(root: Path) -> Iterator[Path]:
    root.mkdir(parents=True, exist_ok=True)
    path = Path(tempfile.mkdtemp(prefix="job-", dir=root))
    try:
        yield path
    finally:
        shutil.rmtree(path, ignore_errors=True)


def handle(job: Job, ctx: JobContext, http: httpx.Client) -> dict[str, Any]:
    """Run `job` and return the body for `POST /internal/media/{asset_id}/processed/`."""
    ctx.check()
    with workdir(ctx.settings.work_dir) as tmp:
        src = tmp / "source"
        transfer.download(
            http,
            job.source.url,
            src,
            max_bytes=_download_cap(job, ctx),
            timeout_s=ctx.settings.transfer_timeout_s,
            attempts=ctx.settings.retry_attempts,
            cancel=ctx.cancel,
        )
        ctx.check()
        info = _probe(ctx, src)
        if job.kind == "analyse":
            return _analyse(job, ctx, http, tmp, src, info)
        return _process(job, ctx, http, tmp, src, info)


def _download_cap(job: Job, ctx: JobContext) -> int:
    declared = job.source.size_bytes
    cap = ctx.settings.max_download_bytes
    return min(declared, cap) if declared > 0 else cap


def _upload_cap(job: Job, ctx: JobContext) -> int:
    return min(
        job.limits.max_output_bytes or ctx.settings.max_upload_bytes, ctx.settings.max_upload_bytes
    )


def _probe(ctx: JobContext, path: Path) -> ProbeInfo:
    return parse_probe(ctx.run(probe_argv(path)).stdout)


def _upload(job: Job, ctx: JobContext, http: httpx.Client, target: OutputTarget, path: Path) -> int:
    ctx.check()
    return transfer.upload(
        http,
        target,
        path,
        max_bytes=_upload_cap(job, ctx),
        timeout_s=ctx.settings.transfer_timeout_s,
        attempts=ctx.settings.retry_attempts,
        cancel=ctx.cancel,
    )


def _process(
    job: Job, ctx: JobContext, http: httpx.Client, tmp: Path, src: Path, info: ProbeInfo
) -> dict[str, Any]:
    uploaded: list[str] = []
    media, media_info = src, info
    if "mp4" in job.outputs and needs_transcode(info, job.limits):
        mp4 = tmp / _FILES["mp4"]
        transcode.run(ctx, src, mp4, info)
        media, media_info = mp4, _probe(ctx, mp4)  # durations of webm sources are unreliable
        _upload(job, ctx, http, job.outputs["mp4"], mp4)
        uploaded.append("mp4")
    # Poster and captions are nice-to-have: their failure must not fail a playable recording.
    if "thumbnail" in job.outputs:
        thumb = tmp / _FILES["thumbnail"]
        target = job.outputs["thumbnail"]
        made = _optional(
            ctx, job, "thumbnail", lambda: thumbnail.run(ctx, media, thumb, media_info)
        )
        if made and _optional(
            ctx, job, "thumbnail_upload", lambda: _upload(job, ctx, http, target, thumb)
        ):
            uploaded.append("thumbnail")
    if "captions" in job.outputs:
        vtt = tmp / _FILES["captions"]
        target = job.outputs["captions"]
        if captions.run(job.words, media_info.duration_ms, vtt) and _optional(
            ctx, job, "captions_upload", lambda: _upload(job, ctx, http, target, vtt)
        ):
            uploaded.append("captions")
    return _report_body(job, media_info, uploaded)


def _report_body(job: Job, info: ProbeInfo, uploaded: list[str]) -> dict[str, Any]:
    """Body for `/processed/`. The API stats each declared output itself, so only slot names go."""
    body: dict[str, Any] = {"job_id": job.id, "status": "ready", "outputs": uploaded}
    for key, value in (
        ("duration_ms", info.duration_ms),
        ("width", info.width),
        ("height", info.height),
    ):
        if value is not None:
            body[key] = value
    return body


def _analyse(
    job: Job, ctx: JobContext, http: httpx.Client, tmp: Path, src: Path, info: ProbeInfo
) -> dict[str, Any]:
    target = job.outputs.get("audio")
    if target is None:
        raise JobFailed("job_invalid", "analyse job has no audio output slot")
    wav = tmp / _FILES["audio"]
    audio.run(ctx, src, wav)
    _upload(job, ctx, http, target, wav)
    return _report_body(job, info, ["audio"])


def _optional(ctx: JobContext, job: Job, step: str, action: Any) -> bool:
    """Run a best-effort step. Cancellation and the job budget still propagate."""
    try:
        result = action()
    except Cancelled:
        raise
    except JobFailed as exc:
        if exc.code == "job_timeout":
            raise
        log(
            logger, logging.WARNING, "optional_step_failed", job_id=job.id, step=step, code=exc.code
        )
        return False
    return True if result is None else bool(result)
