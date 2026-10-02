"""Offline benchmark of an exported acoustic model (docs/features/13 section 8, question "which devices can run it").

    python tools/export_model/benchmark.py MODEL.onnx [--threads 1,2,4] [--seconds 3,8,15] [--runs 5]
                                            [--json out.json] [--check]

Measures, with onnxruntime on THIS machine: file size and sha-256, session load time, inference latency for
clips of several lengths (median, p95, worst, per second of audio, real-time factor), a 15 s estimate, and
the process's peak memory. It prints one table and, with ``--json``, the same numbers for the record.

How to read it:

* This is the **native CPU** number. The browser runs the same model through WebAssembly, single-threaded
  unless the page is cross-origin isolated, which is typically 2-4x slower than native. The in-browser
  benchmark at ``/dev/calibrate`` is the authority for a device class; this one answers "is the model in the
  right ballpark at all" and "does int8 actually help" before any browser is involved.
* The clips are synthetic (seeded noise shaped into syllable-like bursts). Latency of a transformer does not
  depend on what is said, only on how long it is, so that is a fair input for timing and never for accuracy.
* ``--check`` exits 1 if the median 15 s latency or the worst run breaks the exit gate (3 s / 8 s). Run it on
  the machine you care about; a laptop that passes says little about a phone.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import resource
import statistics
import sys
import time
from collections.abc import Callable, Sequence
from pathlib import Path

SAMPLE_RATE = 16_000
GATE_MEDIAN_15S_MS = 3000.0  # docs/features/13 section 8 exit gate
GATE_WORST_15S_MS = 8000.0
REFERENCE_SECONDS = 15.0


# --- pure helpers (no onnxruntime) ---------------------------------------------------------------------


def synthetic_clip(seconds: float, seed: int = 7) -> list[float]:
    """Speech-shaped noise: voiced-ish partials gated into ~3 Hz bursts over a quiet floor. Deterministic."""
    import random

    rng = random.Random(seed)
    n = int(SAMPLE_RATE * seconds)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        gate = 1.0 if math.sin(2 * math.pi * 3.1 * t) > -0.2 else 0.0
        voiced = math.sin(2 * math.pi * 180 * t) + 0.5 * math.sin(2 * math.pi * 360 * t)
        out.append(0.3 * gate * voiced / 1.5 + rng.gauss(0, 1e-3))
    return out


def normalise(samples: Sequence[float]) -> list[float]:
    """Zero mean, unit variance: what the exported wav2vec2 expects."""
    n = len(samples)
    mean = sum(samples) / n
    var = sum((x - mean) ** 2 for x in samples) / n
    std = math.sqrt(var)
    return [(x - mean) / (std + 1e-7) for x in samples]


def percentile(values: Sequence[float], q: float) -> float:
    """Linear-interpolated percentile (q in 0..100) of a non-empty list."""
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * q / 100
    lo, hi = math.floor(rank), math.ceil(rank)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (rank - lo)


def summarise(seconds: float, runs_ms: Sequence[float]) -> dict:
    median = statistics.median(runs_ms)
    return {
        "seconds": seconds,
        "runs": len(runs_ms),
        "median_ms": round(median, 1),
        "p95_ms": round(percentile(runs_ms, 95), 1),
        "worst_ms": round(max(runs_ms), 1),
        "per_second_ms": round(median / seconds, 1),
        "realtime_factor": round(median / (seconds * 1000), 3),
    }


def estimate_15s(rows: Sequence[dict]) -> dict:
    """Latency for a 15 s clip: measured when a 15 s row exists, otherwise median per-second cost x 15."""
    exact = next((r for r in rows if abs(r["seconds"] - REFERENCE_SECONDS) < 1e-6), None)
    if exact:
        return {"median_ms": exact["median_ms"], "worst_ms": exact["worst_ms"], "measured": True}
    per_second = statistics.median(r["per_second_ms"] for r in rows)
    worst = max(r["worst_ms"] / r["seconds"] for r in rows)
    return {
        "median_ms": round(per_second * REFERENCE_SECONDS, 1),
        "worst_ms": round(worst * REFERENCE_SECONDS, 1),
        "measured": False,
    }


def verdict(estimate: dict) -> dict:
    return {
        "median_ok": estimate["median_ms"] <= GATE_MEDIAN_15S_MS,
        "worst_ok": estimate["worst_ms"] <= GATE_WORST_15S_MS,
    }


def peak_rss_mb() -> float:
    """Peak resident memory of this process. `ru_maxrss` is bytes on macOS and kilobytes on Linux."""
    raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(raw / (1024 * 1024 if sys.platform == "darwin" else 1024), 1)


def file_facts(path: Path) -> dict:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    size = path.stat().st_size
    return {"file": path.name, "size_bytes": size, "size_mb": round(size / 1e6, 2), "sha256": digest.hexdigest()}


def parse_ints(text: str) -> list[int]:
    values = [int(part) for part in text.split(",") if part.strip()]
    if not values or any(v <= 0 for v in values):
        raise argparse.ArgumentTypeError("expected positive whole numbers, e.g. 1,2,4")
    return values


def parse_floats(text: str) -> list[float]:
    values = [float(part) for part in text.split(",") if part.strip()]
    if not values or any(v <= 0 for v in values):
        raise argparse.ArgumentTypeError("expected positive numbers, e.g. 3,8,15")
    return values


# --- measurement ---------------------------------------------------------------------------------------

Session = object  # anything with .run(None, {name: array}) and .get_inputs()


def ort_session_factory(model: Path) -> Callable[[int], Session]:
    import onnxruntime as ort  # heavy and optional: imported only when a real run is asked for

    def make(threads: int) -> Session:
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        opts.inter_op_num_threads = 1
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        return ort.InferenceSession(str(model), opts, providers=["CPUExecutionProvider"])

    return make


def measure(
    make_session: Callable[[int], Session],
    *,
    threads: int,
    seconds_list: Sequence[float],
    runs: int,
    warmup: int,
    to_input: Callable[[list[float]], dict],
    clock: Callable[[], float] = time.perf_counter,
) -> dict:
    t0 = clock()
    session = make_session(threads)
    load_ms = (clock() - t0) * 1000
    rows = []
    for seconds in seconds_list:
        feeds = to_input(normalise(synthetic_clip(seconds)))
        for _ in range(warmup):
            session.run(None, feeds)  # type: ignore[attr-defined]
        timings = []
        for _ in range(runs):
            start = clock()
            session.run(None, feeds)  # type: ignore[attr-defined]
            timings.append((clock() - start) * 1000)
        rows.append(summarise(seconds, timings))
    est = estimate_15s(rows)
    return {
        "threads": threads,
        "load_ms": round(load_ms, 1),
        "rows": rows,
        "estimate_15s": est,
        "gate": verdict(est),
    }


def environment() -> dict:
    try:
        import onnxruntime as ort

        version = ort.__version__
    except ImportError:  # only reachable with an injected session factory (tests)
        version = None
    return {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "cpu_count": os.cpu_count(),
        "onnxruntime": version,
    }


def run(
    model: Path,
    *,
    threads: Sequence[int],
    seconds: Sequence[float],
    runs: int,
    warmup: int,
    make_session: Callable[[int], Session] | None = None,
    clock: Callable[[], float] = time.perf_counter,
) -> dict:
    factory = make_session or ort_session_factory(model)
    probe = factory(1)
    inputs = probe.get_inputs()  # type: ignore[attr-defined]
    if len(inputs) != 1:
        raise SystemExit(f"expected one model input (input_values), found {[i.name for i in inputs]}")
    name = inputs[0].name

    def to_input(samples: list[float]) -> dict:
        try:
            import numpy as np
        except ImportError:  # a fake session in a stdlib-only test environment
            return {name: [samples]}
        return {name: np.asarray([samples], dtype=np.float32)}

    results = [
        measure(
            factory, threads=t, seconds_list=seconds, runs=runs, warmup=warmup, to_input=to_input, clock=clock
        )
        for t in threads
    ]
    return {
        "model": file_facts(model),
        "environment": environment(),
        "input": name,
        "peak_rss_mb": peak_rss_mb(),
        "results": results,
    }


def render(report: dict) -> str:
    m, env = report["model"], report["environment"]
    out = [
        f"{m['file']}  {m['size_mb']} MB  sha256 {m['sha256'][:16]}...",
        f"onnxruntime {env['onnxruntime']}  {env['platform']}  {env['cpu_count']} CPUs  peak memory {report['peak_rss_mb']} MB",
        "",
        f"{'threads':>7} {'load ms':>8} {'clip s':>7} {'median':>8} {'p95':>8} {'worst':>8} {'ms/s':>7} {'RTF':>6}",
    ]
    for res in report["results"]:
        for row in res["rows"]:
            out.append(
                f"{res['threads']:>7} {res['load_ms']:>8} {row['seconds']:>7g} {row['median_ms']:>8} "
                f"{row['p95_ms']:>8} {row['worst_ms']:>8} {row['per_second_ms']:>7} {row['realtime_factor']:>6}"
            )
        est, gate = res["estimate_15s"], res["gate"]
        how = "measured" if est["measured"] else "estimated"
        mark = lambda ok: "ok" if ok else "FAIL"
        out.append(
            f"        15 s clip ({how}): median {est['median_ms']} ms [{mark(gate['median_ok'])} <= {GATE_MEDIAN_15S_MS:g}], "
            f"worst {est['worst_ms']} ms [{mark(gate['worst_ok'])} <= {GATE_WORST_15S_MS:g}]"
        )
    out += [
        "",
        "Native CPU. The browser (WASM, usually one thread) is typically 2-4x slower: use /dev/calibrate on the device that matters.",
    ]
    return "\n".join(out)


def passes(report: dict) -> bool:
    return all(r["gate"]["median_ok"] and r["gate"]["worst_ok"] for r in report["results"])


def main(argv: Sequence[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("model", type=Path, help="the exported .onnx file")
    p.add_argument("--threads", type=parse_ints, default=[1, 2, 4], help="intra-op thread counts to try (default 1,2,4)")
    p.add_argument("--seconds", type=parse_floats, default=[3.0, 8.0, 15.0], help="clip lengths to time (default 3,8,15)")
    p.add_argument("--runs", type=int, default=5, help="timed runs per clip (default 5)")
    p.add_argument("--warmup", type=int, default=1, help="untimed runs before timing (default 1)")
    p.add_argument("--json", type=Path, help="also write the full report here")
    p.add_argument("--check", action="store_true", help="exit 1 if any thread count breaks the 15 s latency gate")
    args = p.parse_args(argv)
    if not args.model.is_file():
        p.error(f"no such file: {args.model}")
    if args.runs < 1 or args.warmup < 0:
        p.error("--runs must be at least 1 and --warmup at least 0")
    report = run(args.model, threads=args.threads, seconds=args.seconds, runs=args.runs, warmup=args.warmup)
    print(render(report))
    if args.json:
        args.json.write_text(json.dumps(report, indent=2) + "\n")
    return 0 if (not args.check or passes(report)) else 1


if __name__ == "__main__":
    raise SystemExit(main())
