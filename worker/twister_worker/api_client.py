"""HMAC-signed calls to the Twister API: claim, heartbeat, report. Retries transient failures."""

from __future__ import annotations

import logging
import threading
from typing import Any

import httpx

from .config import Settings
from .errors import TransientError, WorkerError
from .logging_setup import log
from .models import Job
from .retry import call_with_retry
from .signing import signed_request

logger = logging.getLogger(__name__)

_RETRYABLE = (TransientError, httpx.TransportError)


class ApiError(WorkerError):
    """The API answered with a non-retryable error status."""

    def __init__(self, status: int) -> None:
        super().__init__(f"API returned HTTP {status}")
        self.status = status


class ApiClient:
    def __init__(self, settings: Settings, http: httpx.Client) -> None:
        self._settings = settings
        self._http = http

    def claim(self, cancel: threading.Event | None = None) -> Job | None:
        data = self._post("/internal/media/claim/", {}, cancel)
        job = data.get("job")
        return Job.from_payload(job) if job else None

    def heartbeat(self, job_id: str) -> bool:
        """Extend the lease. False means the lease is gone (job finished, re-queued or reclaimed)
        and the worker should abandon it. Transient errors are not fatal: returns True."""
        try:
            self._post(f"/internal/media/jobs/{job_id}/heartbeat/", {}, attempts=2)
        except ApiError as exc:
            return exc.status not in (404, 409, 410)
        except (TransientError, httpx.TransportError):
            return True
        return True

    def report(self, asset_id: str, payload: dict[str, Any]) -> None:
        self._post(f"/internal/media/{asset_id}/processed/", payload)

    def _post(
        self,
        path: str,
        payload: dict[str, Any],
        cancel: threading.Event | None = None,
        attempts: int | None = None,
    ) -> dict[str, Any]:
        url = self._settings.api_base_url + path

        def once() -> dict[str, Any]:
            # Signed per attempt: the timestamp must be fresh when a retry fires after a back-off.
            body, headers = signed_request(self._settings.shared_secret, payload)
            response = self._http.post(
                url, content=body, headers=headers, timeout=self._settings.http_timeout_s
            )
            status = response.status_code
            if status == 429 or status >= 500:
                raise TransientError(f"HTTP {status}")
            if status >= 400:
                raise ApiError(status)
            try:
                data = response.json()
            except ValueError:
                return {}
            return data if isinstance(data, dict) else {}

        try:
            return call_with_retry(
                once,
                attempts=attempts or self._settings.retry_attempts,
                retry_on=_RETRYABLE,
                cancel=cancel,
            )
        except _RETRYABLE as exc:
            log(
                logger,
                logging.WARNING,
                "api_call_failed",
                path_kind=path.split("/")[2],
                error=type(exc).__name__,
            )
            raise
