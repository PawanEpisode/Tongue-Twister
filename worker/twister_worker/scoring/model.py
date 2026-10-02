"""Model cache: download once per sha-256, verify, load an ONNX Runtime session (doc 13 §3.5, D39).

The model is identified by its sha-256 everywhere. A file whose hash or size differs from the claim is
never loaded, and a half-downloaded file is never visible under its final name."""

from __future__ import annotations

import hashlib
import logging
import os
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import numpy as np

from .. import transfer
from ..context import JobContext
from ..errors import JobFailed
from ..logging_setup import log
from .job import ModelRef
from .labels import LabelMap

logger = logging.getLogger(__name__)
LABEL_MAP_MAX_BYTES = 4 * 1024 * 1024
KEEP_MODELS = 2

SessionFactory = Callable[[Path, int], Any]


def check_url(url: str, *, allowed_hosts: tuple[str, ...], api_base_url: str) -> None:
    """Only https (http allowed when the API itself is http, i.e. local dev) and, when configured, only
    the allow-listed hosts: a poisoned claim cannot point the worker at an internal address."""
    parsed = urlparse(url)
    dev = api_base_url.startswith("http://")
    if parsed.scheme != "https" and not (dev and parsed.scheme == "http"):
        raise JobFailed("job_invalid", "download URL must be https")
    host = (parsed.hostname or "").lower()
    if not host:
        raise JobFailed("job_invalid", "download URL has no host")
    if allowed_hosts and not any(host == h or host.endswith("." + h) for h in allowed_hosts):
        raise JobFailed("job_invalid", "download host is not allowed")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def onnx_session(path: Path, threads: int) -> Any:
    try:
        import onnxruntime as ort  # noqa: PLC0415 - heavy import, only scoring workers need it
    except ImportError as exc:
        raise JobFailed("onnx_unavailable", "onnxruntime is not installed") from exc
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    try:
        return ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])
    except Exception as exc:  # noqa: BLE001 - a corrupt/unsupported file is not retryable here
        raise JobFailed("model_corrupt", type(exc).__name__) from exc


@dataclass
class LoadedModel:
    sha256: str
    labels: LabelMap
    session: Any

    def logits(self, samples: np.ndarray) -> np.ndarray:
        """(T, V) raw logits for normalised mono 16 kHz samples."""
        name = self.session.get_inputs()[0].name
        out = self.session.run(None, {name: samples[None, :].astype(np.float32, copy=False)})[0]
        arr = np.asarray(out)
        if arr.ndim == 3:
            arr = arr[0]
        if arr.ndim != 2 or arr.shape[0] == 0 or not np.isfinite(arr).all():
            raise JobFailed("model_output_invalid", f"unexpected output shape {arr.shape}")
        return arr


class ModelStore:
    """One loaded model at a time (memory), a small on-disk cache (restarts)."""

    def __init__(
        self,
        directory: Path,
        *,
        threads: int,
        allowed_hosts: tuple[str, ...],
        api_base_url: str,
        max_model_bytes: int,
        session_factory: SessionFactory = onnx_session,
    ) -> None:
        self._dir = directory
        self._threads = threads
        self._hosts = allowed_hosts
        self._api = api_base_url
        self._max = max_model_bytes
        self._factory = session_factory
        self._lock = threading.Lock()
        self._loaded: LoadedModel | None = None
        self._verified: set[str] = set()

    def get(self, ref: ModelRef, ctx: JobContext, http: httpx.Client) -> LoadedModel:
        with self._lock:
            current = self._loaded
            if current is not None and current.sha256 == ref.sha256:
                if current.labels.version == ref.label_map_version:
                    return current
            labels = self._labels(ref, ctx, http)
            path = self._ensure_file(ref, ctx, http)
            session = (
                current.session
                if current is not None and current.sha256 == ref.sha256
                else self._factory(path, self._threads)
            )
            self._loaded = LoadedModel(ref.sha256, labels, session)
            self._prune(keep=ref.sha256)
            log(logger, logging.INFO, "model_loaded", sha=ref.sha256[:12], name=ref.name)
            return self._loaded

    # -- files -----------------------------------------------------------------------------------
    def _path(self, sha: str) -> Path:
        return self._dir / f"{sha}.onnx"

    def _ensure_file(self, ref: ModelRef, ctx: JobContext, http: httpx.Client) -> Path:
        final = self._path(ref.sha256)
        if final.exists() and final.stat().st_size == ref.size_bytes:
            if ref.sha256 in self._verified or sha256_file(final) == ref.sha256:
                self._verified.add(ref.sha256)
                return final
            final.unlink(missing_ok=True)  # bit rot or a tampered cache: fetch again
        if ref.size_bytes > self._max:
            raise JobFailed("job_invalid", "model is larger than MAX_MODEL_BYTES")
        check_url(ref.url, allowed_hosts=self._hosts, api_base_url=self._api)
        self._dir.mkdir(parents=True, exist_ok=True)
        partial = self._dir / f"{ref.sha256}.{os.getpid()}.part"
        try:
            transfer.download(
                http,
                ref.url,
                partial,
                max_bytes=ref.size_bytes,
                timeout_s=ctx.settings.transfer_timeout_s,
                attempts=ctx.settings.retry_attempts,
                cancel=ctx.cancel,
            )
            ctx.check()
            if partial.stat().st_size != ref.size_bytes or sha256_file(partial) != ref.sha256:
                raise JobFailed("model_corrupt", "downloaded model does not match its sha-256")
            partial.replace(final)
        finally:
            partial.unlink(missing_ok=True)
        self._verified.add(ref.sha256)
        return final

    def _labels(self, ref: ModelRef, ctx: JobContext, http: httpx.Client) -> LabelMap:
        check_url(ref.label_map_url, allowed_hosts=self._hosts, api_base_url=self._api)
        self._dir.mkdir(parents=True, exist_ok=True)
        tmp = self._dir / f"{ref.sha256}.{os.getpid()}.labels"
        try:
            transfer.download(
                http,
                ref.label_map_url,
                tmp,
                max_bytes=LABEL_MAP_MAX_BYTES,
                timeout_s=ctx.settings.http_timeout_s,
                attempts=ctx.settings.retry_attempts,
                cancel=ctx.cancel,
            )
            labels = LabelMap.from_json(tmp.read_bytes())
        finally:
            tmp.unlink(missing_ok=True)
        if labels.version != ref.label_map_version:
            raise JobFailed("label_map_mismatch", "label map is not the version the model needs")
        return labels

    def _prune(self, keep: str) -> None:
        files = sorted(self._dir.glob("*.onnx"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in [p for p in files if p.stem != keep][KEEP_MODELS - 1 :]:
            old.unlink(missing_ok=True)
