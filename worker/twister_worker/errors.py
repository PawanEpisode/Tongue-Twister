"""Exception types. `JobFailed.code` is the short machine code reported to the API."""

PERMANENT_CODES = frozenset(
    {
        "source_too_large",
        "no_video_stream",
        "probe_failed",
        "job_invalid",
        "output_too_large",
        "output_empty",
    }
)


class WorkerError(Exception):
    """Base class for expected worker failures."""


class JobFailed(WorkerError):
    """The job cannot succeed (or ran out of budget). Reported to the API as `failed`."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code

    @property
    def retryable(self) -> bool:
        """False when re-running the same input cannot help (the API then fails the job at once)."""
        return self.code not in PERMANENT_CODES


class Cancelled(WorkerError):
    """Shutdown or a lost lease aborted the job. Nothing is reported: the lease expires and the
    API re-queues the job."""


class TransientError(Exception):
    """A network or 5xx/429 failure that is worth retrying."""


class ConfigError(WorkerError):
    """Missing or invalid environment configuration."""
