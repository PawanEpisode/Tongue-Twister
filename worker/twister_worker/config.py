"""Environment configuration. Parsed once at start-up; invalid values fail fast."""

from __future__ import annotations

import socket
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from .errors import ConfigError

DEFAULT_HEALTH_FILE = "/tmp/twister-worker.alive"  # noqa: S108 - container-local liveness marker


@dataclass(frozen=True)
class Settings:
    api_base_url: str
    shared_secret: str = ""
    poll_interval_s: float = 5.0
    max_job_s: int = 900
    ffmpeg_threads: int = 2
    log_level: str = "INFO"
    worker_id: str = ""
    work_dir: Path = Path(tempfile.gettempdir())
    health_file: Path = Path(DEFAULT_HEALTH_FILE)
    max_download_bytes: int = 209_715_200
    max_upload_bytes: int = 209_715_200
    shutdown_grace_s: float = 20.0
    http_timeout_s: float = 30.0
    transfer_timeout_s: float = 120.0
    retry_attempts: int = 4
    scoring_enabled: bool = False
    model_dir: Path = Path(tempfile.gettempdir()) / "twister-models"
    onnx_threads: int = 2
    allowed_download_hosts: tuple[str, ...] = ()
    max_model_bytes: int = 629_145_600
    max_scoring_audio_bytes: int = 8_388_608

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> Settings:
        base = env.get("API_BASE_URL", "").strip().rstrip("/")
        if not base.startswith(("https://", "http://")):
            raise ConfigError("API_BASE_URL must be an absolute http(s) URL.")
        secret = env.get("WORKER_SHARED_SECRET", "")
        if not secret:
            raise ConfigError("WORKER_SHARED_SECRET is required.")
        level = env.get("LOG_LEVEL", "INFO").upper()
        if level not in {"DEBUG", "INFO", "WARNING", "ERROR"}:
            raise ConfigError("LOG_LEVEL must be DEBUG, INFO, WARNING or ERROR.")
        return cls(
            api_base_url=base,
            shared_secret=secret,
            poll_interval_s=_number(env, "POLL_INTERVAL_S", 5.0, minimum=0.2),
            max_job_s=int(_number(env, "MAX_JOB_S", 900, minimum=10)),
            ffmpeg_threads=int(_number(env, "FFMPEG_THREADS", 2, minimum=1)),
            log_level=level,
            worker_id=env.get("WORKER_ID") or socket.gethostname(),
            work_dir=Path(env.get("WORK_DIR") or tempfile.gettempdir()),
            health_file=Path(env.get("HEALTH_FILE") or DEFAULT_HEALTH_FILE),
            max_download_bytes=int(_number(env, "MAX_DOWNLOAD_BYTES", 209_715_200, minimum=1)),
            max_upload_bytes=int(_number(env, "MAX_UPLOAD_BYTES", 209_715_200, minimum=1)),
            shutdown_grace_s=_number(env, "SHUTDOWN_GRACE_S", 20.0, minimum=0),
            scoring_enabled=env.get("SCORING_ENABLED", "").strip().lower()
            in {"1", "true", "yes", "on"},
            model_dir=Path(env.get("MODEL_DIR") or Path(tempfile.gettempdir()) / "twister-models"),
            onnx_threads=int(_number(env, "ONNX_THREADS", 2, minimum=1)),
            allowed_download_hosts=tuple(
                h.strip().lower()
                for h in env.get("ALLOWED_DOWNLOAD_HOSTS", "").split(",")
                if h.strip()
            ),
            max_model_bytes=int(_number(env, "MAX_MODEL_BYTES", 629_145_600, minimum=1)),
            max_scoring_audio_bytes=int(
                _number(env, "MAX_SCORING_AUDIO_BYTES", 8_388_608, minimum=1)
            ),
        )


def _number(env: Mapping[str, str], name: str, default: float, *, minimum: float) -> float:
    raw = env.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a number.") from None
    if value < minimum:
        raise ConfigError(f"{name} must be >= {minimum:g}.")
    return value
