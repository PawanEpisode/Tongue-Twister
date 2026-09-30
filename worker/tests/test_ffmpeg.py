import json
import sys
import threading
import time
from pathlib import Path

import pytest

from twister_worker import ffmpeg
from twister_worker.errors import Cancelled, JobFailed

SRC, DST = Path("/w/src"), Path("/w/out.mp4")


def info(**kw):
    base = dict(
        duration_s=10.0, width=1280, height=720, video_codec="vp8", has_audio=True,
        container="matroska,webm",
    )  # fmt: skip
    return ffmpeg.ProbeInfo(**{**base, **kw})


def test_transcode_reencodes_webm():
    argv = ffmpeg.transcode_argv(SRC, DST, info=info(), max_height=1080, max_s=600, threads=3)
    assert argv[0] == "ffmpeg"
    assert argv[argv.index("-i") + 1] == str(SRC)
    assert argv[-1] == str(DST)
    assert ["-c:v", "libx264"] == argv[argv.index("-c:v") : argv.index("-c:v") + 2]
    assert "scale=w=-2:h='min(trunc(ih/2)*2,1080)'" in argv
    assert argv[argv.index("-t") + 1] == "600"
    assert argv[argv.index("-threads") + 1] == "3"
    assert argv[argv.index("-af") + 1] == ffmpeg.LOUDNORM
    assert "+faststart" in argv and "0:a:0?" in argv
    assert "-nostdin" in argv and "-y" in argv


def test_transcode_copies_video_for_compliant_mp4():
    mp4 = info(video_codec="h264", container="mov,mp4,m4a,3gp,3g2,mj2", height=1080)
    argv = ffmpeg.transcode_argv(SRC, DST, info=mp4, max_height=1080, max_s=60, threads=1)
    assert argv[argv.index("-c:v") + 1] == "copy"
    assert "libx264" not in argv and "-vf" not in argv
    assert argv[argv.index("-c:a") + 1] == "aac"  # audio is still normalised


@pytest.mark.parametrize(
    "kw",
    [
        dict(height=2160),
        dict(video_codec="hevc"),
        dict(container="matroska,webm"),
        dict(height=None),
    ],
)
def test_can_copy_video_false(kw):
    base = info(video_codec="h264", container="mov,mp4,m4a,3gp,3g2,mj2", height=720)
    assert ffmpeg.can_copy_video(base, 1080)
    assert not ffmpeg.can_copy_video(ffmpeg.ProbeInfo(**{**base.__dict__, **kw}), 1080)


def test_thumbnail_argv():
    argv = ffmpeg.thumbnail_argv(SRC, Path("/w/t.jpg"), at_s=2.5)
    assert argv[argv.index("-ss") + 1] == "2.500"
    assert argv.index("-ss") < argv.index("-i")  # fast input seek
    assert argv[argv.index("-frames:v") + 1] == "1"
    assert argv[-1] == "/w/t.jpg"


def test_thumbnail_position():
    assert ffmpeg.thumbnail_position_s(8.0) == 2.0
    assert ffmpeg.thumbnail_position_s(None) == 0.0
    assert ffmpeg.thumbnail_position_s(0) == 0.0


def test_audio_argv_is_16k_mono_wav():
    argv = ffmpeg.audio_argv(SRC, Path("/w/a.wav"), max_s=90, threads=2)
    assert argv[argv.index("-ar") + 1] == "16000"
    assert argv[argv.index("-ac") + 1] == "1"
    assert argv[argv.index("-c:a") + 1] == "pcm_s16le"
    assert "-vn" in argv and argv[argv.index("-t") + 1] == "90"


def test_parse_probe():
    raw = json.dumps(
        {
            "streams": [
                {"codec_type": "audio"},
                {"codec_type": "video", "codec_name": "h264", "width": 640, "height": 360},
            ],
            "format": {"duration": "1.5", "format_name": "mov,mp4"},
        }
    )
    parsed = ffmpeg.parse_probe(raw)
    assert (parsed.width, parsed.height, parsed.video_codec) == (640, 360, "h264")
    assert parsed.duration_ms == 1500 and parsed.has_audio


def test_parse_probe_unknown_duration_and_errors():
    raw = json.dumps({"streams": [{"codec_type": "video"}], "format": {"duration": "N/A"}})
    assert ffmpeg.parse_probe(raw).duration_ms is None
    with pytest.raises(JobFailed) as no_video:
        ffmpeg.parse_probe(json.dumps({"streams": [{"codec_type": "audio"}]}))
    assert no_video.value.code == "no_video_stream"
    with pytest.raises(JobFailed) as bad:
        ffmpeg.parse_probe("not json")
    assert bad.value.code == "probe_failed"


def test_run_command_success_and_failure():
    ok = ffmpeg.run_command([sys.executable, "-c", "print('hi')"], timeout_s=10)
    assert ok.stdout.strip() == "hi"
    with pytest.raises(JobFailed) as failed:
        ffmpeg.run_command([sys.executable, "-c", "import sys; sys.exit(3)"], timeout_s=10)
    assert failed.value.code == "ffmpeg_failed"


def test_run_command_timeout_and_cancel():
    sleeper = [sys.executable, "-c", "import time; time.sleep(30)"]
    started = time.monotonic()
    with pytest.raises(JobFailed) as timeout:
        ffmpeg.run_command(sleeper, timeout_s=0.5)
    assert timeout.value.code == "ffmpeg_timeout" and time.monotonic() - started < 5
    cancel = threading.Event()
    threading.Timer(0.3, cancel.set).start()
    with pytest.raises(Cancelled):
        ffmpeg.run_command(sleeper, timeout_s=30, cancel=cancel)


def test_run_command_missing_binary():
    with pytest.raises(JobFailed) as missing:
        ffmpeg.run_command(["definitely-not-a-binary"], timeout_s=1)
    assert missing.value.code == "ffmpeg_missing"


def test_needs_transcode_only_for_non_compliant_uploads():
    from twister_worker.models import Limits

    limits = Limits(max_height=1080, max_s=60)
    ok = info(video_codec="h264", container="mov,mp4,m4a,3gp,3g2,mj2", audio_codec="aac")
    assert not ffmpeg.needs_transcode(ok, limits)
    assert not ffmpeg.needs_transcode(info(**{**ok.__dict__, "audio_codec": None}), limits)
    assert ffmpeg.needs_transcode(info(**{**ok.__dict__, "audio_codec": "opus"}), limits)
    assert ffmpeg.needs_transcode(info(**{**ok.__dict__, "duration_s": 61.0}), limits)
    assert ffmpeg.needs_transcode(info(**{**ok.__dict__, "duration_s": None}), limits)
    assert ffmpeg.needs_transcode(info(), limits)  # webm/vp8
