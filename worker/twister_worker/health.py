"""Container HEALTHCHECK: healthy when the runner touched the liveness file recently."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from .config import DEFAULT_HEALTH_FILE

MAX_AGE_S = 120.0


def touch(path: Path) -> None:
    try:
        path.touch()
    except OSError:
        pass  # liveness is best effort; a read-only fs should not kill a job


def is_healthy(path: Path, *, now: float | None = None, max_age_s: float = MAX_AGE_S) -> bool:
    try:
        age = (time.time() if now is None else now) - path.stat().st_mtime
    except OSError:
        return False
    return age <= max_age_s


def main() -> int:
    path = Path(os.environ.get("HEALTH_FILE") or DEFAULT_HEALTH_FILE)
    return 0 if is_healthy(path) else 1


if __name__ == "__main__":
    sys.exit(main())
