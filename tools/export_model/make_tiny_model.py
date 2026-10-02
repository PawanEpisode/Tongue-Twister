"""Builds the tiny stand-in CTC model used to test the browser inference path without a real model.

It honours the same contract as the exported wav2vec2 (input `input_values` (batch, samples); output `logits`
(batch, frames, vocab); 320-sample stride, 400-sample receptive field) using one fixed-weight Conv1d, so the
frame count matches the real model exactly. It is committed as web/e2e/fixtures/tiny-ctc.onnx together with
tiny-ctc.ref.json (what onnxruntime computes for the 1 s, 220 Hz test tone after the web runner's normalisation),
which the Playwright `accurate-csp` test compares the in-browser result against.

    python tools/export_model/make_tiny_model.py web/e2e/fixtures
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

VOCAB = 4
KERNEL = 400
STRIDE = 320


def build(out_dir: Path) -> None:
    import onnx
    import onnxruntime as ort
    from onnx import TensorProto, helper, numpy_helper

    rng = np.random.default_rng(0)
    weight = (rng.standard_normal((VOCAB, 1, KERNEL)) * 0.02).astype(np.float32)
    bias = rng.standard_normal(VOCAB).astype(np.float32)
    nodes = [
        helper.make_node("Unsqueeze", ["input_values", "axes"], ["x"]),
        helper.make_node("Conv", ["x", "W", "B"], ["y"], kernel_shape=[KERNEL], strides=[STRIDE]),
        helper.make_node("Transpose", ["y"], ["logits"], perm=[0, 2, 1]),
    ]
    graph = helper.make_graph(
        nodes,
        "tiny_ctc",
        [helper.make_tensor_value_info("input_values", TensorProto.FLOAT, ["batch", "samples"])],
        [helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["batch", "frames", VOCAB])],
        [
            numpy_helper.from_array(weight, "W"),
            numpy_helper.from_array(bias, "B"),
            numpy_helper.from_array(np.array([1], dtype=np.int64), "axes"),
        ],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)])
    model.ir_version = 9
    onnx.checker.check_model(model)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "tiny-ctc.onnx"
    onnx.save(model, path)

    t = np.arange(16_000, dtype=np.float32) / 16_000
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    normalised = (tone - tone.mean()) / (tone.std() + 1e-7)
    logits = ort.InferenceSession(str(path)).run(None, {"input_values": normalised[None]})[0][0]
    (out_dir / "tiny-ctc.ref.json").write_text(json.dumps(logits.round(5).tolist()))


if __name__ == "__main__":
    build(Path(sys.argv[1] if len(sys.argv) > 1 else "."))
