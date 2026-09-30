import threading

import pytest

from twister_worker import health
from twister_worker.errors import Cancelled, TransientError
from twister_worker.retry import backoff_delay, call_with_retry


def test_backoff_grows_caps_and_jitters():
    assert backoff_delay(0, base_s=1, max_s=30, jitter=1.0) == 1.0
    assert backoff_delay(0, base_s=1, max_s=30, jitter=0.0) == 0.5
    assert backoff_delay(3, base_s=1, max_s=30, jitter=1.0) == 8.0
    assert backoff_delay(10, base_s=1, max_s=30, jitter=1.0) == 30.0


def test_retries_then_succeeds():
    calls, sleeps = [], []

    def flaky():
        calls.append(1)
        if len(calls) < 3:
            raise TransientError("x")
        return "ok"

    out = call_with_retry(
        flaky, attempts=4, retry_on=(TransientError,), sleep=sleeps.append, rand=lambda: 1.0
    )
    assert out == "ok" and len(calls) == 3 and sleeps == [1.0, 2.0]


def test_gives_up_and_does_not_retry_other_errors():
    with pytest.raises(TransientError):
        call_with_retry(
            lambda: (_ for _ in ()).throw(TransientError("x")),
            attempts=2,
            retry_on=(TransientError,),
            sleep=lambda _: None,
        )
    calls = []

    def boom():
        calls.append(1)
        raise ValueError

    with pytest.raises(ValueError):
        call_with_retry(boom, attempts=5, retry_on=(TransientError,), sleep=lambda _: None)
    assert len(calls) == 1


def test_cancel_stops_before_calling():
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(Cancelled):
        call_with_retry(lambda: 1, attempts=3, retry_on=(TransientError,), cancel=cancel)


def test_health(tmp_path):
    path = tmp_path / "alive"
    assert not health.is_healthy(path)
    health.touch(path)
    assert health.is_healthy(path)
    assert not health.is_healthy(path, now=path.stat().st_mtime + 500)
