"""Per-job execution context: settings, limits, the job deadline and the cancel flag."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from .config import Settings
from .errors import Cancelled, JobFailed
from .ffmpeg import CommandResult, run_command
from .models import Limits


@dataclass
class JobContext:
    settings: Settings
    limits: Limits
    cancel: threading.Event = field(default_factory=threading.Event)
    started: float = field(default_factory=time.monotonic)

    def remaining_s(self) -> float:
        return self.settings.max_job_s - (time.monotonic() - self.started)

    def check(self) -> None:
        if self.cancel.is_set():
            raise Cancelled("cancelled")
        if self.remaining_s() <= 0:
            raise JobFailed("job_timeout", "job exceeded MAX_JOB_S")

    def run(self, argv: list[str]) -> CommandResult:
        """Run an ffmpeg/ffprobe command bounded by the remaining job budget."""
        self.check()
        return run_command(argv, timeout_s=self.remaining_s(), cancel=self.cancel)
