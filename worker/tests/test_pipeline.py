import pytest

from tests.conftest import job_payload
from tests.fakes import FakeStore, fake_run
from twister_worker import pipeline
from twister_worker.context import JobContext
from twister_worker.errors import Cancelled, JobFailed
from twister_worker.models import Job


@pytest.fixture(autouse=True)
def _fake_ffmpeg(monkeypatch):
    monkeypatch.setattr(JobContext, "run", fake_run)
    monkeypatch.setattr("twister_worker.retry.time.sleep", lambda _: None)


def ctx_for(settings, job):
    return JobContext(settings, job.limits)


def test_process_uploads_all_outputs_and_reports_paths(settings, job):
    store = FakeStore()
    payload = pipeline.handle(job, ctx_for(settings, job), store.client())
    assert payload["status"] == "ready" and payload["job_id"] == "job-1"
    assert payload["outputs"] == ["mp4", "thumbnail", "captions"]
    assert (payload["duration_ms"], payload["width"], payload["height"]) == (4000, 640, 360)
    assert set(store.uploads) == {"/up/mp4", "/up/thumb", "/up/vtt"}
    assert store.uploads["/up/vtt"].decode().startswith("WEBVTT")


def test_work_dir_is_cleaned_up(settings, job):
    pipeline.handle(job, ctx_for(settings, job), FakeStore().client())
    assert list(settings.work_dir.iterdir()) == []


def test_rerun_is_idempotent(settings, job):
    store = FakeStore()
    first = pipeline.handle(job, ctx_for(settings, job), store.client())
    second = pipeline.handle(job, ctx_for(settings, job), store.client())
    assert first == second and len(store.uploads) == 3


def test_captions_skipped_without_words(settings):
    job = Job.from_payload(job_payload(words=None))
    payload = pipeline.handle(job, ctx_for(settings, job), FakeStore().client())
    assert payload["outputs"] == ["mp4", "thumbnail"]


def test_thumbnail_failure_is_not_fatal(settings, job, monkeypatch):
    def flaky(self, argv):
        if "-frames:v" in argv:
            raise JobFailed("ffmpeg_failed", "boom")
        return fake_run(self, argv)

    monkeypatch.setattr(JobContext, "run", flaky)
    payload = pipeline.handle(job, ctx_for(settings, job), FakeStore().client())
    assert payload["status"] == "ready" and payload["outputs"] == ["mp4", "captions"]


def test_transcode_failure_is_fatal(settings, job, monkeypatch):
    def broken(self, argv):
        if argv[0] == "ffmpeg" and "libx264" in argv:
            raise JobFailed("ffmpeg_failed", "boom")
        return fake_run(self, argv)

    monkeypatch.setattr(JobContext, "run", broken)
    with pytest.raises(JobFailed) as err:
        pipeline.handle(job, ctx_for(settings, job), FakeStore().client())
    assert err.value.code == "ffmpeg_failed"


def test_analyse_produces_audio_only(settings):
    data = job_payload(
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
    job = Job.from_payload(data)
    store = FakeStore()
    payload = pipeline.handle(job, ctx_for(settings, job), store.client())
    assert payload["outputs"] == ["audio"] and list(store.uploads) == ["/up/wav"]


def test_analyse_without_audio_slot_is_invalid(settings):
    job = Job.from_payload(job_payload(kind="analyse", outputs={}))
    with pytest.raises(JobFailed) as err:
        pipeline.handle(job, ctx_for(settings, job), FakeStore().client())
    assert err.value.code == "job_invalid"


def test_source_size_cap_comes_from_the_job(settings):
    job = Job.from_payload(
        job_payload(source={"url": "https://store.test/s", "mime": "video/webm", "size_bytes": 10})
    )
    with pytest.raises(JobFailed) as err:
        pipeline.handle(job, ctx_for(settings, job), FakeStore(source=b"x" * 500).client())
    assert err.value.code == "source_too_large"


def test_output_cap_comes_from_limits(settings):
    data = job_payload()
    data["limits"]["max_output_bytes"] = 2
    job = Job.from_payload(data)
    with pytest.raises(JobFailed) as err:
        pipeline.handle(job, ctx_for(settings, job), FakeStore().client())
    assert err.value.code == "output_too_large"


def test_cancelled_and_expired_budget(settings, job):
    ctx = ctx_for(settings, job)
    ctx.cancel.set()
    with pytest.raises(Cancelled):
        pipeline.handle(job, ctx, FakeStore().client())
    late = ctx_for(settings, job)
    late.started -= 10_000
    with pytest.raises(JobFailed) as err:
        pipeline.handle(job, late, FakeStore().client())
    assert err.value.code == "job_timeout"


def test_compliant_mp4_is_not_re_encoded(settings, job, monkeypatch):
    import json

    from tests.fakes import PROBE

    probe = json.loads(PROBE)
    probe["streams"][0]["codec_name"] = "h264"
    probe["streams"][1]["codec_name"] = "aac"
    probe["format"]["format_name"] = "mov,mp4,m4a,3gp,3g2,mj2"
    calls = []

    def run(self, argv):
        calls.append(argv)
        if argv[0] == "ffprobe":
            from twister_worker.ffmpeg import CommandResult

            return CommandResult(json.dumps(probe), "")
        return fake_run(self, argv)

    monkeypatch.setattr(JobContext, "run", run)
    store = FakeStore()
    payload = pipeline.handle(job, ctx_for(settings, job), store.client())
    assert payload["outputs"] == ["thumbnail", "captions"] and "/up/mp4" not in store.uploads
    assert not any("libx264" in a or "copy" in a for a in calls)
