"""Runs real ffmpeg/ffprobe on a generated 1 s clip. Skipped when ffmpeg is not installed."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from tests.conftest import job_payload
from tests.fakes import FakeStore
from twister_worker import pipeline
from twister_worker.context import JobContext
from twister_worker.ffmpeg import FFPROBE, parse_probe, probe_argv
from twister_worker.models import Job

HAVE = shutil.which("ffmpeg") and shutil.which("ffprobe")
pytestmark = pytest.mark.skipif(not HAVE, reason="ffmpeg/ffprobe not installed")


def make_clip(path: Path, vcodec: str, fmt: str, acodec: str) -> bytes:
    subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=1",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", vcodec, "-c:a", acodec, "-f", fmt, str(path)],
        check=True,
    )  # fmt: skip
    return path.read_bytes()


def probe(path: Path):
    return parse_probe(
        subprocess.run(probe_argv(path), capture_output=True, text=True, check=True).stdout
    )


def run_job(settings, tmp_path, source: bytes, payload: dict):
    payload["source"]["size_bytes"] = len(source)
    job = Job.from_payload(payload)
    store = FakeStore(source=source)
    result = pipeline.handle(job, JobContext(settings, job.limits), store.client())
    return result, store


def test_webm_is_transcoded_to_mp4_with_thumbnail_and_captions(settings, tmp_path):
    source = make_clip(tmp_path / "in.webm", "libvpx", "webm", "libvorbis")
    result, store = run_job(settings, tmp_path, source, job_payload())
    assert result["status"] == "ready" and result["outputs"] == ["mp4", "thumbnail", "captions"]
    out = tmp_path / "out.mp4"
    out.write_bytes(store.uploads["/up/mp4"])
    info = probe(out)
    assert info.video_codec == "h264" and info.has_audio and "mp4" in info.container
    assert info.duration_s == pytest.approx(1.0, abs=0.3)
    assert result["duration_ms"] == pytest.approx(1000, abs=300)
    assert store.uploads["/up/thumb"][:2] == b"\xff\xd8"  # JPEG magic
    assert store.uploads["/up/vtt"].startswith(b"WEBVTT")


def test_large_video_is_downscaled(settings, tmp_path):
    source = make_clip(tmp_path / "in.webm", "libvpx", "webm", "libvorbis")
    payload = job_payload()
    payload["limits"]["max_height"] = 120
    _, store = run_job(settings, tmp_path, source, payload)
    out = tmp_path / "small.mp4"
    out.write_bytes(store.uploads["/up/mp4"])
    assert probe(out).height == 120


def test_compliant_mp4_is_served_as_is(settings, tmp_path):
    source = make_clip(tmp_path / "in.mp4", "libx264", "mp4", "aac")
    result, store = run_job(settings, tmp_path, source, job_payload())
    assert "mp4" not in result["outputs"] and "/up/mp4" not in store.uploads
    assert store.uploads["/up/thumb"][:2] == b"\xff\xd8"
    assert (result["width"], result["height"]) == (320, 240)


def test_h264_with_other_audio_copies_video_and_normalises_audio(settings, tmp_path):
    source = make_clip(tmp_path / "in.mp4", "libx264", "mp4", "libmp3lame")
    _, store = run_job(settings, tmp_path, source, job_payload())
    out = tmp_path / "out.mp4"
    out.write_bytes(store.uploads["/up/mp4"])
    info = probe(out)
    assert info.video_codec == "h264" and info.audio_codec == "aac"


def test_analyse_makes_16k_mono_wav(settings, tmp_path):
    source = make_clip(tmp_path / "in.webm", "libvpx", "webm", "libvorbis")
    payload = job_payload(
        kind="analyse",
        outputs={
            "audio": {
                "path": "p/a.wav",
                "upload_url": "https://store.test/up/wav",
                "token": "",
                "mime": "audio/wav",
            }
        },
    )
    result, store = run_job(settings, tmp_path, source, payload)
    wav = tmp_path / "a.wav"
    wav.write_bytes(store.uploads["/up/wav"])
    streams = json.loads(
        subprocess.run([FFPROBE, "-v", "error", "-print_format", "json", "-show_streams", str(wav)],
                       capture_output=True, text=True, check=True).stdout
    )["streams"]  # fmt: skip
    assert (streams[0]["sample_rate"], streams[0]["channels"]) == ("16000", 1)
    assert result["outputs"] == ["audio"]


def test_corrupt_source_fails_cleanly(settings, tmp_path):
    from twister_worker.errors import JobFailed

    with pytest.raises(JobFailed) as err:
        run_job(settings, tmp_path, b"not a video at all" * 10, job_payload())
    assert err.value.code in {"ffmpeg_failed", "probe_failed", "no_video_stream"}
