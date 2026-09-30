from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from twister_worker.config import Settings
from twister_worker.models import Job


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        api_base_url="https://api.test/api/v1",
        shared_secret="s3cret",
        poll_interval_s=0.2,
        max_job_s=60,
        work_dir=tmp_path / "work",
        health_file=tmp_path / "alive",
        worker_id="w1",
        retry_attempts=2,
        shutdown_grace_s=0.2,
    )


def job_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": "job-1",
        "kind": "process",
        "recording_id": "rec-1",
        "asset_id": "asset-1",
        "lease_s": 30,
        "source": {
            "url": "https://store.test/src?sig=abc",
            "mime": "video/webm",
            "size_bytes": 1000,
        },
        "outputs": {
            "mp4": {
                "path": "p/out.mp4",
                "upload_url": "https://store.test/up/mp4",
                "token": "t1",
                "mime": "video/mp4",
            },
            "thumbnail": {
                "path": "p/t.jpg",
                "upload_url": "https://store.test/up/thumb",
                "token": "t2",
                "mime": "image/jpeg",
            },
            "captions": {
                "path": "p/c.vtt",
                "upload_url": "https://store.test/up/vtt",
                "token": "t3",
                "mime": "text/vtt",
            },
        },
        "words": [
            {"target": "Peter", "start_ms": 100, "end_ms": 400, "status": "correct"},
            {"target": "Piper", "start_ms": 400, "end_ms": 800, "status": "correct"},
        ],
        "limits": {"max_height": 1080, "max_s": 600},
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def job() -> Job:
    return Job.from_payload(job_payload())
