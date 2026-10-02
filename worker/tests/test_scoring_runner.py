"""The runner claims scoring jobs, heartbeats them on the scoring endpoint and reports to /result/."""

from __future__ import annotations

from dataclasses import replace

import pytest

from tests.test_scoring import make_wav, payload
from twister_worker.errors import JobFailed
from twister_worker.runner import Worker
from twister_worker.scoring import handler
from twister_worker.scoring.job import ScoringJob


class Api:
    def __init__(self, raw=None, media=None):
        self.raw, self.media = raw, media
        self.scoring_reports: list[tuple[str, dict]] = []
        self.order: list[str] = []

    def claim(self, cancel=None):
        self.order.append("media")
        return self.media

    def claim_scoring(self, cancel=None):
        self.order.append("scoring")
        raw, self.raw = self.raw, None
        return raw

    def heartbeat_scoring(self, job_id):
        return True

    def report_scoring(self, job_id, body):
        self.scoring_reports.append((job_id, body))


def scoring_job(tmp_path):
    return ScoringJob.from_payload(payload(make_wav(tmp_path / "a.wav")))


def test_a_scoring_job_is_reported_to_the_result_endpoint(settings, tmp_path, monkeypatch):
    monkeypatch.setattr(handler, "handle", lambda *a: {"status": "done", "score": 88})
    api = Api()
    Worker(settings, api, None).process_scoring(scoring_job(tmp_path))
    assert api.scoring_reports == [
        ("11111111-1111-1111-1111-111111111111", {"status": "done", "score": 88})
    ]


def test_known_failures_carry_a_code_and_retryability_and_no_detail(
    settings, tmp_path, monkeypatch
):
    def boom(*_):
        raise JobFailed("model_corrupt", "path /secret/thing")

    monkeypatch.setattr(handler, "handle", boom)
    api = Api()
    Worker(settings, api, None).process_scoring(scoring_job(tmp_path))
    body = api.scoring_reports[0][1]
    assert body == {"status": "failed", "error_code": "model_corrupt", "retryable": True}


def test_a_crash_is_reported_as_internal_error(settings, tmp_path, monkeypatch):
    def boom(*_):
        raise RuntimeError("secret")

    monkeypatch.setattr(handler, "handle", boom)
    api = Api()
    Worker(settings, api, None).process_scoring(scoring_job(tmp_path))
    assert api.scoring_reports[0][1]["error_code"] == "internal_error"
    assert "secret" not in str(api.scoring_reports)


def test_scoring_is_not_polled_unless_enabled(settings):
    api = Api()
    Worker(settings, api, None)._claim_next()
    assert api.order == ["media"]


def test_media_and_scoring_alternate_when_enabled(settings):
    api = Api()
    worker = Worker(replace(settings, scoring_enabled=True), api, None)
    firsts = []
    for _ in range(4):
        api.order.clear()
        worker._claim_next()
        firsts.append(api.order[0])
    assert set(firsts) == {"media", "scoring"} and firsts[0] != firsts[1]


def test_a_malformed_scoring_claim_is_rejected_not_executed(settings):
    api = Api(raw={"id": "x"})
    worker = Worker(replace(settings, scoring_enabled=True), api, None)
    worker._turn = 0  # the next claim asks scoring first
    with pytest.raises(JobFailed) as exc:
        worker._claim_next()
    assert exc.value.code == "job_invalid"
