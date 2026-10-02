"""The poll loop: claim -> handle -> report, one job at a time, with lease heartbeats and a
graceful SIGTERM (finish the current job within a grace window, then abandon it for re-queue)."""

from __future__ import annotations

import logging
import signal
import threading
import time
from typing import Any

import httpx

from . import health, pipeline
from .api_client import ApiClient
from .config import Settings
from .context import JobContext
from .errors import Cancelled, JobFailed, TransientError
from .logging_setup import configure_logging, log
from .models import Job, Limits
from .scoring import handler as scoring_handler
from .scoring.job import ScoringJob
from .scoring.model import ModelStore

logger = logging.getLogger(__name__)


class Worker:
    def __init__(self, settings: Settings, api: ApiClient, http: httpx.Client) -> None:
        self._settings = settings
        self._api = api
        self._http = http
        self._stop = threading.Event()
        self._current_cancel: threading.Event | None = None
        self._timer: threading.Timer | None = None
        self._turn = 0
        self._store: ModelStore | None = None

    # -- lifecycle ---------------------------------------------------------------------------
    def request_stop(self) -> None:
        """SIGTERM/SIGINT: stop claiming; give a running job the grace window, then cancel it."""
        if self._stop.is_set():
            return
        self._stop.set()
        if self._current_cancel is not None:
            self._arm_grace(self._current_cancel)
        log(logger, logging.INFO, "shutdown_requested")

    def _arm_grace(self, cancel: threading.Event) -> None:
        self._timer = threading.Timer(self._settings.shutdown_grace_s, cancel.set)
        self._timer.daemon = True
        self._timer.start()

    def run(self) -> None:
        log(logger, logging.INFO, "worker_started", worker_id=self._settings.worker_id)
        failures = 0
        while not self._stop.is_set():
            health.touch(self._settings.health_file)
            try:
                job = self._claim_next()
            except Cancelled:
                break
            except Exception as exc:  # the loop must survive API outages and bad payloads
                failures += 1
                if isinstance(exc, JobFailed):
                    log(logger, logging.ERROR, "claim_rejected", code=exc.code)
                else:
                    log(logger, logging.WARNING, "claim_failed", error=type(exc).__name__)
                self._stop.wait(min(60.0, self._settings.poll_interval_s * 2 ** min(failures, 5)))
                continue
            failures = 0
            if job is None:
                self._stop.wait(self._settings.poll_interval_s)
                continue
            if isinstance(job, ScoringJob):
                self.process_scoring(job)
            else:
                self.process(job)
        log(logger, logging.INFO, "worker_stopped")

    def _claim_next(self) -> Job | ScoringJob | None:
        """Media jobs and scoring jobs share this worker; the first claim alternates so neither starves."""
        kinds = ["media", "scoring"] if self._settings.scoring_enabled else ["media"]
        self._turn += 1
        error: Exception | None = None
        for kind in kinds[self._turn % len(kinds) :] + kinds[: self._turn % len(kinds)]:
            try:
                if kind == "media":
                    found = self._api.claim(self._stop)
                else:
                    raw = self._api.claim_scoring(self._stop)
                    found = ScoringJob.from_payload(raw) if raw else None
            except Cancelled:
                raise
            except Exception as exc:  # noqa: BLE001 - the other queue may still have work
                error = error or exc
                continue
            if found is not None:
                return found
        if error is not None:
            raise error
        return None

    # -- one job -----------------------------------------------------------------------------
    def process(self, job: Job) -> None:
        ctx = JobContext(self._settings, job.limits)
        self._current_cancel = ctx.cancel
        if self._stop.is_set():  # stop arrived between claim and start
            self._arm_grace(ctx.cancel)
        beat_stop = threading.Event()
        beat = threading.Thread(
            target=self._heartbeat,
            args=(job.id, job.lease_s, self._api.heartbeat, ctx, beat_stop),
            daemon=True,
        )
        beat.start()
        started = time.monotonic()
        log(logger, logging.INFO, "job_started", job_id=job.id, kind=job.kind)
        try:
            payload = pipeline.handle(job, ctx, self._http)
        except Cancelled:
            log(logger, logging.WARNING, "job_abandoned", job_id=job.id)
            return
        except JobFailed as exc:
            payload = {
                "job_id": job.id,
                "status": "failed",
                "error": exc.code,
                "retryable": exc.retryable,
            }
            log(logger, logging.WARNING, "job_failed", job_id=job.id, code=exc.code)
        except Exception as exc:
            payload = {"job_id": job.id, "status": "failed", "error": "internal_error"}
            log(logger, logging.ERROR, "job_crashed", job_id=job.id, error=type(exc).__name__)
        finally:
            beat_stop.set()
            beat.join(timeout=5)
            self._current_cancel = None
            if self._timer is not None:
                self._timer.cancel()
        self._report(job, payload)
        log(
            logger,
            logging.INFO,
            "job_finished",
            job_id=job.id,
            status=payload["status"],
            seconds=round(time.monotonic() - started, 2),
        )

    def process_scoring(self, job: ScoringJob) -> None:
        """Same lifecycle as `process` (heartbeats, graceful stop), different endpoints and handler."""
        ctx = JobContext(self._settings, Limits(max_height=0, max_s=job.max_audio_s))
        self._current_cancel = ctx.cancel
        if self._stop.is_set():
            self._arm_grace(ctx.cancel)
        beat_stop = threading.Event()
        beat = threading.Thread(
            target=self._heartbeat,
            args=(job.id, job.lease_s, self._api.heartbeat_scoring, ctx, beat_stop),
            daemon=True,
        )
        beat.start()
        started = time.monotonic()
        log(logger, logging.INFO, "job_started", job_id=job.id, kind=job.kind)
        try:
            payload = scoring_handler.handle(job, ctx, self._http, self._model_store())
        except Cancelled:
            log(logger, logging.WARNING, "job_abandoned", job_id=job.id)
            return
        except JobFailed as exc:
            payload = {"status": "failed", "error_code": exc.code, "retryable": exc.retryable}
            log(logger, logging.WARNING, "job_failed", job_id=job.id, code=exc.code)
        except Exception as exc:
            payload = {"status": "failed", "error_code": "internal_error", "retryable": True}
            log(logger, logging.ERROR, "job_crashed", job_id=job.id, error=type(exc).__name__)
        finally:
            beat_stop.set()
            beat.join(timeout=5)
            self._current_cancel = None
            if self._timer is not None:
                self._timer.cancel()
        try:
            self._api.report_scoring(job.id, payload)
        except (
            Exception
        ) as exc:  # the lease expires and the job is retried; reporting twice is idempotent
            log(logger, logging.ERROR, "report_failed", job_id=job.id, error=type(exc).__name__)
        log(
            logger,
            logging.INFO,
            "job_finished",
            job_id=job.id,
            status=payload["status"],
            seconds=round(time.monotonic() - started, 2),
        )

    def _model_store(self) -> ModelStore:
        if self._store is None:
            cfg = self._settings
            self._store = ModelStore(
                cfg.model_dir,
                threads=cfg.onnx_threads,
                allowed_hosts=cfg.allowed_download_hosts,
                api_base_url=cfg.api_base_url,
                max_model_bytes=cfg.max_model_bytes,
            )
        return self._store

    def _report(self, job: Job, payload: dict[str, object]) -> None:
        try:
            self._api.report(job.asset_id, payload)
        except Exception as exc:  # lease expiry re-queues the job; reporting twice is idempotent
            log(logger, logging.ERROR, "report_failed", job_id=job.id, error=type(exc).__name__)

    def _heartbeat(
        self, job_id: str, lease_s: int, beat: Any, ctx: JobContext, done: threading.Event
    ) -> None:
        interval = max(1.0, lease_s / 3)
        while not done.wait(interval):
            health.touch(self._settings.health_file)
            try:
                alive = beat(job_id)
            except TransientError:
                alive = True
            if not alive:
                log(logger, logging.WARNING, "lease_lost", job_id=job_id)
                ctx.cancel.set()
                return


def main(env: dict[str, str] | None = None) -> int:
    import os

    from .config import Settings
    from .errors import ConfigError

    try:
        settings = Settings.from_env(os.environ if env is None else env)
    except ConfigError as exc:
        print(f"configuration error: {exc}")  # noqa: T201 - logging is not configured yet
        return 2
    configure_logging(settings.log_level)
    with httpx.Client(follow_redirects=False) as http:
        worker = Worker(settings, ApiClient(settings, http), http)
        signal.signal(signal.SIGTERM, lambda *_: worker.request_stop())
        signal.signal(signal.SIGINT, lambda *_: worker.request_stop())
        worker.run()
    return 0
