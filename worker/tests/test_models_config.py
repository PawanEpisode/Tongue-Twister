import pytest

from tests.conftest import job_payload
from twister_worker.config import Settings
from twister_worker.errors import ConfigError, JobFailed
from twister_worker.models import Job


def test_job_parses_outputs_words_limits():
    parsed = Job.from_payload(job_payload())
    assert parsed.kind == "process" and set(parsed.outputs) == {"mp4", "thumbnail", "captions"}
    assert parsed.words and parsed.words[0].start_ms == 100
    assert parsed.limits.max_height == 1080 and parsed.limits.max_output_bytes is None


def test_job_words_may_be_null_and_timings_missing():
    assert Job.from_payload(job_payload(words=None)).words is None
    parsed = Job.from_payload(job_payload(words=[{"target": "a"}, {"target": "b", "start_ms": -1}]))
    assert [(w.start_ms, w.end_ms) for w in parsed.words] == [(None, None), (None, None)]


def test_unknown_outputs_are_ignored_and_null_outputs_ok():
    data = job_payload(outputs={"evil": {"path": "x"}, "mp4": None})
    assert Job.from_payload(data).outputs == {}


@pytest.mark.parametrize(
    "bad",
    [
        {"kind": "delete"},
        {"asset_id": "../etc"},
        {"id": "a/b"},
        {"source": {"url": "file:///etc/passwd", "mime": "x", "size_bytes": 1}},
        {"source": {"mime": "x"}},
        {"limits": {"max_height": "tall", "max_s": 1}},
    ],
)
def test_malformed_payloads_raise_job_invalid(bad):
    with pytest.raises(JobFailed) as err:
        Job.from_payload(job_payload(**bad))
    assert err.value.code == "job_invalid"


def test_job_repr_hides_urls_and_tokens():
    text = repr(Job.from_payload(job_payload()))
    assert (
        "store.test" not in text and "sig=abc" not in text and "t1" not in text.replace("job-1", "")
    )


ENV = {"API_BASE_URL": "https://api.test/api/v1/", "WORKER_SHARED_SECRET": "x"}


def test_settings_defaults_and_overrides():
    s = Settings.from_env(
        {**ENV, "POLL_INTERVAL_S": "2.5", "MAX_JOB_S": "120", "FFMPEG_THREADS": "4"}
    )
    assert s.api_base_url == "https://api.test/api/v1"
    assert (s.poll_interval_s, s.max_job_s, s.ffmpeg_threads, s.log_level) == (2.5, 120, 4, "INFO")


@pytest.mark.parametrize(
    "env",
    [
        {"WORKER_SHARED_SECRET": "x"},
        {"API_BASE_URL": "ftp://x", "WORKER_SHARED_SECRET": "x"},
        {"API_BASE_URL": "https://x"},
        {**ENV, "MAX_JOB_S": "abc"},
        {**ENV, "FFMPEG_THREADS": "0"},
        {**ENV, "LOG_LEVEL": "LOUD"},
    ],
)
def test_settings_reject_bad_env(env):
    with pytest.raises(ConfigError):
        Settings.from_env(env)


def test_failure_retryability():
    assert JobFailed("ffmpeg_failed").retryable and JobFailed("upload_failed").retryable
    assert not JobFailed("source_too_large").retryable and not JobFailed("job_invalid").retryable
