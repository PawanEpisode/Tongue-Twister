#!/usr/bin/env python3
"""Export the pronunciation acoustic model (wav2vec2 phoneme CTC) to ONNX, optionally int8-quantised,
and write a manifest the Twister API / web app can consume (docs/features/10-in-house-pronunciation-engine.md
sections 3.1 and 6).

Everything except the `hf` backend uses the standard library only, so `--dry-run`, `--backend fake`,
`--verify` and the unit tests run anywhere. The `hf` backend imports torch / transformers / onnx /
onnxruntime lazily (see requirements.txt).

Output layout (`--out`/<name>/):
    <name>.onnx        the model to publish (int8 when --quantize int8, else fp32)
    vocab.json         the model's label vocabulary (input to the label-map generator, doc 10 section 4.1)
    manifest.json      see MANIFEST_SCHEMA below; `model` maps 1:1 to the AcousticModelVersion fields
    SHA256SUMS         `sha256sum -c` compatible
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

TOOL_VERSION = "1.0.0"
MANIFEST_SCHEMA = 1
DEFAULT_MODEL_ID = "facebook/wav2vec2-lv-60-espeak-cv-ft"
DEFAULT_NAME_PREFIX = "w2v-espeak-lv60"
SAMPLE_RATE = 16_000
FRAME_STRIDE = 320  # wav2vec2 conv stack: 20 ms at 16 kHz
SANITY_SECONDS = 2.0
MB = 1024 * 1024
# Expected on-disk size window per quantisation for the default (large, ~300 M parameter) model. Doc 10 estimates
# ~1.2 GB fp32 / ~300 MB int8 ("measure after export"). Override with --size-range-mb for other models.
DEFAULT_SIZE_RANGE_MB = {"fp32": (900, 1600), "int8": (200, 500)}
MAX_INT8_TO_FP32_RATIO = 0.5
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")  # AcousticModelVersion.name max_length=80
LABEL_MAP_VERSION_MAX = 20  # AcousticModelVersion.label_map_version max_length=20
# The manifest `model` block carries exactly these keys, named like the AcousticModelVersion columns
# (api/twisters/models.py) so the admin form / a one-off script can copy them across.
MODEL_KEYS = (
    "name",
    "base_model",
    "licence",
    "quantization",
    "size_bytes",
    "sha256",
    "download_url",
    "label_map_version",
)


class ExportError(Exception):
    """A user-facing failure: message printed, exit code 1."""


# --- backend interface ---------------------------------------------------------------------------


@dataclass
class ModelInfo:
    base_model: str
    revision: str  # resolved commit hash when known ("" for the fake backend)
    vocab: dict[str, int]
    preprocess: dict[str, Any]
    tool_versions: dict[str, str] = field(default_factory=dict)


@dataclass
class Inference:
    frames: int
    vocab_size: int
    finite: bool
    argmax: list[int]  # per-frame argmax label, for fp32-vs-int8 agreement


class Backend(Protocol):
    def missing_dependencies(self) -> list[str]: ...
    def prepare(self, model_id: str, revision: str | None) -> ModelInfo: ...
    def export_fp32(self, dest: Path, opset: int) -> None: ...
    def quantize_int8(self, src: Path, dest: Path) -> None: ...
    def infer(self, path: Path, samples: list[float]) -> Inference: ...


class FakeBackend:
    """A tiny stand-in (no weights, no third-party packages) used by `--backend fake` and the tests.

    "Models" are small files; inference returns deterministic frames so the sanity checks run for real.
    """

    def __init__(self, vocab_size: int = 8, fp32_bytes: int = 4096, int8_ratio: float = 0.3) -> None:
        self.vocab_size = vocab_size
        self.fp32_bytes = fp32_bytes
        self.int8_ratio = int8_ratio

    def missing_dependencies(self) -> list[str]:
        return []

    def prepare(self, model_id: str, revision: str | None) -> ModelInfo:
        vocab = {"<pad>": 0, "a": 1, "b": 2, "ʃ": 3, "s": 4, "tʃ": 5, "ɹ": 6, "|": 7}
        return ModelInfo(
            base_model=model_id,
            revision=revision or "fake-rev",
            vocab={k: v for k, v in vocab.items() if v < self.vocab_size},
            preprocess={"sample_rate": SAMPLE_RATE, "normalize": "zero_mean_unit_var"},
            tool_versions={"backend": "fake"},
        )

    def export_fp32(self, dest: Path, opset: int) -> None:
        dest.write_bytes(b"FAKE-ONNX-FP32" + b"\x00" * (self.fp32_bytes - 14))

    def quantize_int8(self, src: Path, dest: Path) -> None:
        n = max(16, int(src.stat().st_size * self.int8_ratio))
        dest.write_bytes(b"FAKE-ONNX-INT8" + b"\x00" * (n - 14))

    def infer(self, path: Path, samples: list[float]) -> Inference:
        frames = (len(samples) - 400) // FRAME_STRIDE + 1
        return Inference(frames, self.vocab_size, True, [(i * 7) % self.vocab_size for i in range(frames)])


class HFBackend:
    """Real export. Needs the packages in requirements.txt and network access to Hugging Face."""

    REQUIRED = ("torch", "transformers", "onnx", "onnxruntime", "numpy")

    def __init__(self) -> None:
        self._model: Any = None

    def missing_dependencies(self) -> list[str]:
        import importlib.util

        return [m for m in self.REQUIRED if importlib.util.find_spec(m) is None]

    def prepare(self, model_id: str, revision: str | None) -> ModelInfo:
        import onnx
        import onnxruntime
        import torch
        import transformers
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC

        model = Wav2Vec2ForCTC.from_pretrained(model_id, revision=revision)
        model.eval()
        extractor = Wav2Vec2FeatureExtractor.from_pretrained(model_id, revision=revision)
        vocab_path = _hf_download(model_id, "vocab.json", revision)
        vocab = json.loads(Path(vocab_path).read_text("utf-8"))
        self._model = model
        resolved = getattr(model.config, "_commit_hash", None) or revision or ""
        return ModelInfo(
            base_model=model_id,
            revision=resolved,
            vocab=vocab,
            preprocess={
                "sample_rate": int(extractor.sampling_rate),
                "normalize": "zero_mean_unit_var" if extractor.do_normalize else "none",
            },
            tool_versions={
                "torch": torch.__version__,
                "transformers": transformers.__version__,
                "onnx": onnx.__version__,
                "onnxruntime": onnxruntime.__version__,
            },
        )

    def export_fp32(self, dest: Path, opset: int) -> None:
        import torch

        class Logits(torch.nn.Module):
            def __init__(self, inner: Any) -> None:
                super().__init__()
                self.inner = inner

            def forward(self, input_values: Any) -> Any:  # (batch, samples) -> (batch, frames, vocab)
                return self.inner(input_values).logits

        dummy = torch.randn(1, int(SANITY_SECONDS * SAMPLE_RATE))
        with torch.no_grad():
            torch.onnx.export(
                Logits(self._model),
                (dummy,),
                str(dest),
                input_names=["input_values"],
                output_names=["logits"],
                dynamic_axes={
                    "input_values": {0: "batch", 1: "samples"},
                    "logits": {0: "batch", 1: "frames"},
                },
                opset_version=opset,
                do_constant_folding=True,
            )

    def quantize_int8(self, src: Path, dest: Path) -> None:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        quantize_dynamic(str(src), str(dest), weight_type=QuantType.QInt8)

    def infer(self, path: Path, samples: list[float]) -> Inference:
        import numpy as np
        import onnxruntime as ort

        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        x = np.asarray(samples, dtype=np.float32)[None, :]
        x = (x - x.mean()) / (x.std() + 1e-7)
        (logits,) = session.run(["logits"], {"input_values": x})
        return Inference(
            frames=int(logits.shape[1]),
            vocab_size=int(logits.shape[2]),
            finite=bool(np.isfinite(logits).all()),
            argmax=[int(i) for i in logits[0].argmax(axis=-1)],
        )


def _hf_download(model_id: str, filename: str, revision: str | None) -> str:
    from huggingface_hub import hf_hub_download

    return hf_hub_download(model_id, filename, revision=revision)


# --- pure helpers (all unit-tested) -----------------------------------------------------------------


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while block := fh.read(chunk):
            digest.update(block)
    return digest.hexdigest()


def make_name(prefix: str, quantization: str, release: int) -> str:
    return f"{prefix}-{quantization}-r{release}"


def synthetic_samples(seconds: float = SANITY_SECONDS, rate: int = SAMPLE_RATE) -> list[float]:
    """Deterministic voiced-looking test signal (no randomness, no numpy)."""
    n = int(seconds * rate)
    return [
        0.3 * math.sin(2 * math.pi * 140 * i / rate) + 0.15 * math.sin(2 * math.pi * 1200 * i / rate)
        for i in range(n)
    ]


def expected_frames(n_samples: int) -> int:
    return (n_samples - 400) // FRAME_STRIDE + 1


def check_size(quantization: str, size_bytes: int, size_range_mb: tuple[float, float]) -> list[str]:
    lo, hi = size_range_mb
    problems = []
    if size_bytes <= 0:
        problems.append("model file is empty")
    elif not lo * MB <= size_bytes <= hi * MB:
        problems.append(
            f"{quantization} size {size_bytes / MB:.1f} MB is outside the expected {lo:g}-{hi:g} MB "
            "(wrong model? truncated export? pass --size-range-mb if intentional)"
        )
    return problems


def check_vocab(vocab: dict[str, int], vocab_size: int) -> list[str]:
    problems = []
    if not vocab:
        return ["vocab.json is empty"]
    ids = sorted(vocab.values())
    if len(set(ids)) != len(ids):
        problems.append("vocab.json has duplicate ids")
    if ids[0] < 0 or ids[-1] >= vocab_size:
        problems.append(f"vocab ids span {ids[0]}..{ids[-1]} but the model emits {vocab_size} labels")
    if len(vocab) != vocab_size:
        problems.append(f"vocab has {len(vocab)} labels but the model emits {vocab_size}")
    return problems


def check_inference(inf: Inference, n_samples: int, vocab: dict[str, int]) -> list[str]:
    problems = []
    if not inf.finite:
        problems.append("model output contains NaN/inf")
    want = expected_frames(n_samples)
    if abs(inf.frames - want) > 3:
        problems.append(f"expected about {want} frames for {n_samples} samples, got {inf.frames}")
    problems += check_vocab(vocab, inf.vocab_size)
    return problems


def agreement(a: list[int], b: list[int]) -> float:
    n = min(len(a), len(b))
    return sum(1 for x, y in zip(a[:n], b[:n], strict=True) if x == y) / n if n else 0.0


def file_entry(path: Path, role: str, base: Path) -> dict[str, Any]:
    return {
        "path": path.relative_to(base).as_posix(),
        "role": role,
        "size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def build_manifest(
    *,
    name: str,
    info: ModelInfo,
    licence: str,
    quantization: str,
    model_file: Path,
    other_files: list[tuple[Path, str]],
    out_dir: Path,
    base_url: str,
    label_map_version: str,
    opset: int,
    checks: dict[str, Any],
    now: datetime | None = None,
) -> dict[str, Any]:
    model_entry = file_entry(model_file, "model", out_dir)
    url = f"{base_url.rstrip('/')}/{name}/{model_file.name}" if base_url else ""
    model = {
        "name": name,
        "base_model": info.base_model,
        "licence": licence,
        "quantization": quantization,
        "size_bytes": model_entry["size_bytes"],
        "sha256": model_entry["sha256"],
        "download_url": url,
        "label_map_version": label_map_version,
    }
    return {
        "schema": MANIFEST_SCHEMA,
        "model": model,
        "files": [model_entry] + [file_entry(p, role, out_dir) for p, role in other_files],
        "input": {"name": "input_values", "shape": ["batch", "samples"], **info.preprocess},
        "output": {
            "name": "logits",
            "shape": ["batch", "frames", len(info.vocab)],
            "frame_stride_samples": FRAME_STRIDE,
            "frame_ms": 20,
        },
        "export": {
            "tool_version": TOOL_VERSION,
            "created_at": (now or datetime.now(UTC)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source_revision": info.revision,
            "opset": opset,
            "host": f"{platform.system()} {platform.machine()}",
            "python": platform.python_version(),
            "tool_versions": info.tool_versions,
            "checks": checks,
        },
    }


def validate_manifest(manifest: dict[str, Any]) -> list[str]:
    """Structural check of a manifest dict (used by --verify and tests)."""
    problems = []
    if manifest.get("schema") != MANIFEST_SCHEMA:
        problems.append(f"schema must be {MANIFEST_SCHEMA}")
    model = manifest.get("model") or {}
    for key in MODEL_KEYS:
        if key not in model:
            problems.append(f"model.{key} missing")
    if model.get("quantization") not in ("fp32", "fp16", "int8"):
        problems.append("model.quantization must be fp32, fp16 or int8")
    if not re.fullmatch(r"[0-9a-f]{64}", str(model.get("sha256", ""))):
        problems.append("model.sha256 is not a 64-char hex digest")
    if not NAME_RE.match(str(model.get("name", ""))):
        problems.append("model.name is invalid")
    if len(str(model.get("label_map_version", ""))) > LABEL_MAP_VERSION_MAX:
        problems.append("model.label_map_version too long")
    files = manifest.get("files") or []
    if not files or files[0].get("role") != "model":
        problems.append("files[0] must be the model")
    elif files[0].get("sha256") != model.get("sha256") or files[0].get("size_bytes") != model.get(
        "size_bytes"
    ):
        problems.append("model block and files[0] disagree")
    return problems


def verify_directory(directory: Path) -> list[str]:
    """Recompute every checksum listed in manifest.json (run this before uploading, and after downloading)."""
    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file():
        return [f"{manifest_path} not found"]
    manifest = json.loads(manifest_path.read_text("utf-8"))
    problems = validate_manifest(manifest)
    for entry in manifest.get("files", []):
        path = directory / entry["path"]
        if not path.is_file():
            problems.append(f"{entry['path']} is missing")
        elif path.stat().st_size != entry["size_bytes"]:
            problems.append(f"{entry['path']} size differs from the manifest")
        elif sha256_file(path) != entry["sha256"]:
            problems.append(f"{entry['path']} checksum differs from the manifest")
    return problems


def write_sha256sums(directory: Path, files: list[Path]) -> Path:
    path = directory / "SHA256SUMS"
    path.write_text(
        "".join(f"{sha256_file(f)}  {f.relative_to(directory).as_posix()}\n" for f in files), "utf-8"
    )
    return path


# --- orchestration --------------------------------------------------------------------------------------


@dataclass
class Options:
    model_id: str = DEFAULT_MODEL_ID
    revision: str | None = None
    quantize: str = "int8"  # "none" | "int8"
    opset: int = 17
    out: Path = Path("out")
    name_prefix: str = DEFAULT_NAME_PREFIX
    release: int = 1
    licence: str = "Apache-2.0"
    base_url: str = ""
    label_map_version: str = "lm1"
    size_range_mb: tuple[float, float] | None = None
    keep_fp32: bool = False
    force: bool = False
    dry_run: bool = False

    @property
    def quantization(self) -> str:
        return "int8" if self.quantize == "int8" else "fp32"

    @property
    def name(self) -> str:
        return make_name(self.name_prefix, self.quantization, self.release)

    @property
    def out_dir(self) -> Path:
        return self.out / self.name

    def size_range(self) -> tuple[float, float]:
        return self.size_range_mb or DEFAULT_SIZE_RANGE_MB[self.quantization]


def validate_options(opts: Options) -> list[str]:
    problems = []
    if not NAME_RE.match(opts.name):
        problems.append(f"derived name {opts.name!r} is invalid (letters, digits, . _ - ; max 80)")
    if len(opts.label_map_version) > LABEL_MAP_VERSION_MAX or not opts.label_map_version:
        problems.append(f"--label-map-version must be 1-{LABEL_MAP_VERSION_MAX} characters")
    if opts.release < 1:
        problems.append("--release must be >= 1")
    if opts.base_url and not opts.base_url.startswith("https://"):
        problems.append("--base-url must be https:// (the app never loads a model over plain http)")
    if "huggingface" in opts.base_url:
        problems.append("--base-url must be our own storage, never Hugging Face (doc 10 section 3.1)")
    lo, hi = opts.size_range()
    if not 0 < lo < hi:
        problems.append("--size-range-mb must be MIN,MAX with 0 < MIN < MAX")
    if opts.opset < 14:
        problems.append("--opset must be >= 14 for wav2vec2")
    return problems


def plan(opts: Options) -> list[str]:
    steps = [
        f"download {opts.model_id}" + (f" @ {opts.revision}" if opts.revision else " @ latest (not pinned!)"),
        f"export fp32 ONNX (opset {opts.opset}, dynamic batch/samples) -> {opts.out_dir}/{make_name(opts.name_prefix, 'fp32', opts.release)}.onnx"
        if opts.quantization == "int8"
        else f"export fp32 ONNX (opset {opts.opset}) -> {opts.out_dir}/{opts.name}.onnx",
    ]
    if opts.quantization == "int8":
        steps.append(f"dynamic int8 quantisation -> {opts.out_dir}/{opts.name}.onnx")
    lo, hi = opts.size_range()
    steps += [
        f"size check: {opts.quantization} must be {lo:g}-{hi:g} MB"
        + (f", int8 < {MAX_INT8_TO_FP32_RATIO:.0%} of fp32" if opts.quantization == "int8" else ""),
        f"sanity inference on {SANITY_SECONDS:g} s synthetic audio (finite, ~{expected_frames(int(SANITY_SECONDS * SAMPLE_RATE))} frames, vocab matches)",
        "write vocab.json, manifest.json, SHA256SUMS",
    ]
    return steps


def run_export(opts: Options, backend: Backend, log=print) -> dict[str, Any]:
    problems = validate_options(opts)
    if problems:
        raise ExportError("; ".join(problems))
    missing = backend.missing_dependencies()
    if missing:
        raise ExportError(
            f"missing packages: {', '.join(missing)}. Run: pip install -r tools/export_model/requirements.txt"
        )
    out_dir = opts.out_dir
    if out_dir.exists() and any(out_dir.iterdir()) and not opts.force:
        raise ExportError(f"{out_dir} is not empty; pass --force to replace it")
    opts.out.mkdir(parents=True, exist_ok=True)

    # Build in a temp dir beside the destination so a failed run leaves nothing half-written.
    work = Path(tempfile.mkdtemp(prefix=".export-", dir=opts.out))
    try:
        log(f"[1/5] loading {opts.model_id}")
        info = backend.prepare(opts.model_id, opts.revision)
        stage = work / opts.name
        stage.mkdir()
        samples = synthetic_samples()
        checks: dict[str, Any] = {}

        fp32_name = make_name(opts.name_prefix, "fp32", opts.release)
        fp32_path = (stage / f"{fp32_name}.onnx") if opts.quantization == "int8" else (stage / f"{opts.name}.onnx")
        log(f"[2/5] exporting fp32 ONNX (opset {opts.opset})")
        backend.export_fp32(fp32_path, opts.opset)
        if not fp32_path.is_file():
            raise ExportError("exporter produced no file")
        # Models over 2 GB are split into external data; refuse rather than publish half a model.
        stray = [p.name for p in stage.iterdir() if p.suffix == ".data" or p.name.endswith(".onnx_data")]
        if stray:
            raise ExportError(f"export produced external-data files {stray}; the app expects one file")

        final_path = fp32_path
        fp32_size = fp32_path.stat().st_size
        fp32_inf = backend.infer(fp32_path, samples)
        problems = check_inference(fp32_inf, len(samples), info.vocab)
        if opts.quantization == "fp32":
            problems += check_size("fp32", fp32_size, opts.size_range())
        checks["fp32"] = {"size_bytes": fp32_size, "frames": fp32_inf.frames, "vocab_size": fp32_inf.vocab_size}

        if opts.quantization == "int8":
            log("[3/5] quantising to int8")
            final_path = stage / f"{opts.name}.onnx"
            backend.quantize_int8(fp32_path, final_path)
            if not final_path.is_file():
                raise ExportError("quantiser produced no file")
            q_size = final_path.stat().st_size
            problems += check_size("int8", q_size, opts.size_range())
            if q_size >= MAX_INT8_TO_FP32_RATIO * fp32_size:
                problems.append(
                    f"int8 is {q_size / fp32_size:.0%} of fp32 (expected < {MAX_INT8_TO_FP32_RATIO:.0%}); "
                    "quantisation probably did not apply"
                )
            q_inf = backend.infer(final_path, samples)
            problems += check_inference(q_inf, len(samples), info.vocab)
            agree = agreement(fp32_inf.argmax, q_inf.argmax)
            checks["int8"] = {
                "size_bytes": q_size,
                "ratio_to_fp32": round(q_size / fp32_size, 4),
                "frames": q_inf.frames,
                "argmax_agreement_vs_fp32": round(agree, 4),
            }
            if agree < 0.5:
                log(f"  WARNING: int8 and fp32 agree on only {agree:.0%} of frames of the synthetic clip. "
                    "Coarse signal, but benchmark on the gold clips before publishing.")
        else:
            log("[3/5] skipping quantisation (--quantize none)")

        if problems:
            raise ExportError("sanity checks failed:\n  - " + "\n  - ".join(problems))
        log("[4/5] checks passed")

        vocab_path = stage / "vocab.json"
        vocab_path.write_text(json.dumps(info.vocab, ensure_ascii=False, indent=2, sort_keys=True) + "\n", "utf-8")
        others: list[tuple[Path, str]] = [(vocab_path, "vocab")]
        if opts.quantization == "int8" and opts.keep_fp32:
            others.append((fp32_path, "fp32-intermediate"))
        elif opts.quantization == "int8":
            fp32_path.unlink()

        manifest = build_manifest(
            name=opts.name,
            info=info,
            licence=opts.licence,
            quantization=opts.quantization,
            model_file=final_path,
            other_files=others,
            out_dir=stage,
            base_url=opts.base_url,
            label_map_version=opts.label_map_version,
            opset=opts.opset,
            checks=checks,
        )
        bad = validate_manifest(manifest)
        if bad:
            raise ExportError("manifest invalid: " + "; ".join(bad))
        (stage / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", "utf-8")
        write_sha256sums(stage, [final_path] + [p for p, _ in others] + [stage / "manifest.json"])
        again = verify_directory(stage)
        if again:
            raise ExportError("self-verification failed: " + "; ".join(again))

        if out_dir.exists():
            shutil.rmtree(out_dir)
        stage.rename(out_dir)
        log(f"[5/5] wrote {out_dir}")
        return manifest
    finally:
        shutil.rmtree(work, ignore_errors=True)


def disk_free_mb(path: Path) -> float:
    probe = path
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    return shutil.disk_usage(probe).free / MB


# --- CLI ---------------------------------------------------------------------------------------------------


def parse_size_range(text: str) -> tuple[float, float]:
    try:
        lo, hi = (float(x) for x in text.split(","))
    except ValueError:
        raise argparse.ArgumentTypeError("expected MIN,MAX in MB, e.g. 200,500") from None
    return lo, hi


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Export the pronunciation model to ONNX (+ int8) and write a manifest.",
        epilog="Always start with --dry-run. See tools/export_model/README.md.",
    )
    p.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    p.add_argument("--hf-revision", default=None, help="Hugging Face commit hash to pin (recommended)")
    p.add_argument("--quantize", choices=("int8", "none"), default="int8")
    p.add_argument("--opset", type=int, default=17)
    p.add_argument("--out", type=Path, default=Path("out"))
    p.add_argument("--name-prefix", default=DEFAULT_NAME_PREFIX, help="name = <prefix>-<fp32|int8>-r<release>")
    p.add_argument("--release", type=int, default=1)
    p.add_argument("--licence", default="Apache-2.0", help="verify against the model card (doc 10 sec 1)")
    p.add_argument("--base-url", default="", help="https://.../ prefix where you will upload; fills download_url")
    p.add_argument("--label-map-version", default="lm1")
    p.add_argument("--size-range-mb", type=parse_size_range, default=None, help="MIN,MAX override")
    p.add_argument("--keep-fp32", action="store_true", help="keep and list the fp32 file next to the int8 one")
    p.add_argument("--force", action="store_true", help="replace an existing output directory")
    p.add_argument("--dry-run", action="store_true", help="validate and print the plan; write nothing")
    p.add_argument("--backend", choices=("hf", "fake"), default="hf", help="`fake` writes tiny stand-in files")
    p.add_argument("--verify", type=Path, metavar="DIR", help="re-check DIR/manifest.json checksums and exit")
    return p


def options_from_args(a: argparse.Namespace) -> Options:
    return Options(
        model_id=a.model_id,
        revision=a.hf_revision,
        quantize=a.quantize,
        opset=a.opset,
        out=a.out,
        name_prefix=a.name_prefix,
        release=a.release,
        licence=a.licence,
        base_url=a.base_url,
        label_map_version=a.label_map_version,
        size_range_mb=a.size_range_mb,
        keep_fp32=a.keep_fp32,
        force=a.force,
        dry_run=a.dry_run,
    )


def main(argv: list[str] | None = None, backend: Backend | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.verify:
        problems = verify_directory(args.verify)
        for line in problems:
            print(f"FAIL {line}")
        print("OK: all checksums match" if not problems else f"{len(problems)} problem(s)")
        return 1 if problems else 0

    opts = options_from_args(args)
    if backend is None:
        backend = FakeBackend() if args.backend == "fake" else HFBackend()
    if args.backend == "fake" and opts.size_range_mb is None:
        opts.size_range_mb = (0.0001, 1.0)  # fake files are a few KB
    try:
        problems = validate_options(opts)
        if opts.dry_run:
            print(f"DRY RUN - nothing will be written or downloaded\nname: {opts.name}\noutput: {opts.out_dir}")
            for i, step in enumerate(plan(opts), 1):
                print(f"  {i}. {step}")
            missing = backend.missing_dependencies()
            print(f"packages: {'all present' if not missing else 'MISSING ' + ', '.join(missing)}")
            if opts.out_dir.exists() and any(opts.out_dir.iterdir()) and not opts.force:
                problems.append(f"{opts.out_dir} exists and is not empty (use --force)")
            free = disk_free_mb(opts.out)
            print(f"free disk at output: {free / 1024:.1f} GB (need roughly 4 GB for the default model)")
            if not opts.revision:
                print("note: no --hf-revision, so the export is not reproducible; pin a commit for releases")
            if problems:
                for line in problems:
                    print(f"PROBLEM {line}")
                return 1
            print("OK")
            return 0
        manifest = run_export(opts, backend)
    except ExportError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    model = manifest["model"]
    print(json.dumps(model, indent=2, ensure_ascii=False))
    print(f"\nNext: upload {opts.out_dir}/ to storage, then create the AcousticModelVersion from the block above.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
