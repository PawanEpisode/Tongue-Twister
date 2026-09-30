import threading
import time

import pytest

from tests.conftest import job_payload
from twister_worker import pipeline
from twister_worker.errors import Cancelled, JobFailed
from twister_worker.models import Job
from twister_worker.runner import Worker


class FakeApi:
    def __init__(self, jobs=(), claim_error=None, heartbeat_alive=True):
        self.jobs = list(jobs)
        self.claim_error = claim_error
        self.reports: list[tuple[str, dict]] = []
        self.heartbeats = 0
        self.heartbeat_alive = heartbeat_alive
        self.on_empty = None

    def claim(self, cancel=None):
        if self.claim_error:
            raise self.claim_error
        if self.jobs:
            return self.jobs.pop(0)
        if self.on_empty:
            self.on_empty()
        return None

    def heartbeat(self, job_id):
        self.heartbeats += 1
        return self.heartbeat_alive

    def report(self, asset_id, payload):
        self.reports.append((asset_id, payload))


def make(settings, api, http=None):
    return Worker(settings, api, http)


def test_success_is_reported_once(settings, job, monkeypatch):
    monkeypatch.setattr(pipeline, "handle", lambda j, c, h: {"job_id": j.id, "status": "ready"})
    api = FakeApi()
    make(settings, api).process(job)
    assert api.reports == [("asset-1", {"job_id": "job-1", "status": "ready"})]


def test_known_failure_reports_code(settings, job, monkeypatch):
    def fail(*_):
        raise JobFailed("ffmpeg_failed", "secret detail")

    monkeypatch.setattr(pipeline, "handle", fail)
    api = FakeApi()
    make(settings, api).process(job)
    assert api.reports[0][1] == {
        "job_id": "job-1",
        "status": "failed",
        "error": "ffmpeg_failed",
        "retryable": True,
    }


def test_unexpected_crash_reports_internal_error(settings, job, monkeypatch):
    def crash(*_):
        raise RuntimeError("secret detail")

    monkeypatch.setattr(pipeline, "handle", crash)
    api = FakeApi()
    make(settings, api).process(job)
    assert api.reports[0][1]["error"] == "internal_error"
    assert "secret" not in str(api.reports)


def test_cancelled_job_is_not_reported(settings, job, monkeypatch):
    def cancelled(*_):
        raise Cancelled("x")

    monkeypatch.setattr(pipeline, "handle", cancelled)
    api = FakeApi()
    make(settings, api).process(job)
    assert api.reports == []


def test_report_failure_does_not_crash(settings, job, monkeypatch):
    monkeypatch.setattr(pipeline, "handle", lambda j, c, h: {"job_id": j.id, "status": "ready"})
    api = FakeApi()
    api.report = lambda *_: (_ for _ in ()).throw(RuntimeError("down"))
    make(settings, api).process(job)  # must not raise


def test_lost_lease_cancels_the_job(settings, monkeypatch):
    job = Job.from_payload(job_payload(lease_s=1))
    seen = {}

    def slow(j, ctx, http):
        seen["cancelled"] = ctx.cancel.wait(5)
        raise Cancelled("lease")

    monkeypatch.setattr(pipeline, "handle", slow)
    api = FakeApi(heartbeat_alive=False)
    make(settings, api).process(job)
    assert seen["cancelled"] is True and api.reports == []


def test_heartbeats_while_running(settings, monkeypatch):
    job = Job.from_payload(job_payload(lease_s=1))  # beats every 1 s (minimum)

    def slow(j, ctx, http):
        time.sleep(1.4)
        return {"job_id": j.id, "status": "ready"}

    monkeypatch.setattr(pipeline, "handle", slow)
    api = FakeApi()
    make(settings, api).process(job)
    assert api.heartbeats >= 1 and settings.health_file.exists()


def test_loop_claims_until_stopped_and_survives_claim_errors(settings, monkeypatch):
    monkeypatch.setattr(pipeline, "handle", lambda j, c, h: {"job_id": j.id, "status": "ready"})
    api = FakeApi(jobs=[Job.from_payload(job_payload())])
    worker = make(settings, api)
    api.on_empty = worker.request_stop
    worker.run()
    assert len(api.reports) == 1

    broken = FakeApi(claim_error=RuntimeError("api down"))
    w2 = make(settings, broken)
    threading.Timer(0.3, w2.request_stop).start()
    w2.run()  # retries with backoff and exits cleanly on stop
    assert broken.reports == []


def test_sigterm_lets_job_finish_within_grace(settings, job, monkeypatch):
    worker = make(settings, FakeApi())

    def finishing(j, ctx, http):
        worker.request_stop()
        time.sleep(0.05)
        assert not ctx.cancel.is_set()
        return {"job_id": j.id, "status": "ready"}

    monkeypatch.setattr(pipeline, "handle", finishing)
    worker.process(job)
    assert worker._api.reports[0][1]["status"] == "ready"


def test_sigterm_cancels_job_after_grace(settings, job, monkeypatch):
    worker = make(settings, FakeApi())

    def stuck(j, ctx, http):
        worker.request_stop()
        assert ctx.cancel.wait(3), "grace timer should cancel the job"
        raise Cancelled("grace")

    monkeypatch.setattr(pipeline, "handle", stuck)
    worker.process(job)
    assert worker._api.reports == []


@pytest.mark.parametrize("env", [{}, {"API_BASE_URL": "https://x"}])
def test_main_rejects_bad_config(env):
    from twister_worker.runner import main

    assert main(env) == 2
