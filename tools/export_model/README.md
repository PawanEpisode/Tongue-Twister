# export_model: pronunciation model -> ONNX (+ int8) + manifest

One-time (per model release) task on **your Mac**, per `docs/features/10-in-house-pronunciation-engine.md`
section 3.1: download the wav2vec2 phoneme-CTC weights from Hugging Face, export to ONNX, quantise to int8,
check the result, and write a manifest. You then upload the files to **our own storage**; the app never loads
a model from Hugging Face at runtime.

The script is one file (`export_model.py`). Everything except the real export uses only the standard library, so
`--dry-run`, `--backend fake`, `--verify` and the unit tests need no installs.

## What you get

```
out/w2v-espeak-lv60-int8-r1/
  w2v-espeak-lv60-int8-r1.onnx   the file to publish (~300 MB expected for int8; ~1.2 GB for fp32)
  vocab.json                     label -> id; input to the label-map generator (doc 10 section 4.1)
  manifest.json                  see below
  SHA256SUMS                     verify with: cd out/<name> && shasum -a 256 -c SHA256SUMS
```

`manifest.json -> model` has exactly the `AcousticModelVersion` columns (`api/twisters/models.py`):
`name`, `base_model`, `licence`, `quantization`, `size_bytes`, `sha256`, `download_url`, `label_map_version`.
The API's `GET /engine/manifest/` serves those (as `name`, ..., `sha256`, `url`, ...) and the browser caches the
model **by `sha256`**, so the hash in the database must be the hash of the uploaded file. Other manifest blocks:
`files[]` (path, role, size, sha256 of each file), `input` / `output` (tensor names, 16 kHz, normalisation,
320-sample = 20 ms frames, vocab size), `export` (tool versions, source revision, opset, checks run).

## Setup (once)

```bash
cd tools/export_model
python3.12 -m venv .venv && source .venv/bin/activate     # 3.11 or 3.12
pip install -r requirements.txt                           # torch, transformers, onnx, onnxruntime (~2 GB)
```

## Run

1. Dry run (no downloads, no writes; shows the plan, missing packages, free disk, problems):
   ```bash
   python export_model.py --dry-run
   ```
2. Pick and pin the Hugging Face commit (so the export is reproducible): open
   `https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft/commits/main`, copy the commit hash, and **check the
   licence on the model card** (doc 10 expects Apache-2.0; change `--licence` if it differs).
3. Export. `--base-url` is where you will upload (our storage, https); it only fills `download_url`:
   ```bash
   python export_model.py \
     --hf-revision <commit-hash> \
     --release 1 \
     --label-map-version lm1 \
     --base-url https://<project>.supabase.co/storage/v1/object/public/models \
     --out out
   ```
   This downloads about 1.2 GB, exports fp32, quantises to int8 (dynamic, QInt8 weights), runs the checks, and prints
   the `model` block. Takes several minutes. Add `--keep-fp32` to keep the fp32 file too, `--quantize none` for
   fp32 only, `--force` to replace an existing `out/<name>`.
4. Re-verify before and after upload (recomputes every checksum in `manifest.json`):
   ```bash
   python export_model.py --verify out/w2v-espeak-lv60-int8-r1
   ```
5. Upload `out/<name>/` to the URL you used for `--base-url` (so the file is at
   `<base-url>/<name>/<name>.onnx`), download it back, and run `--verify` on the downloaded copy.
6. In Django admin create an **Acoustic model version** from the printed `model` block (leave `active` unticked), run
   the gold-clip benchmark (doc 10 section 7), then follow `docs/runbooks/model-rollback.md` to turn it on
   behind the `accurate_mode` flag.

## Checks the script enforces (a failure aborts and leaves no output)

| Check | Why |
|---|---|
| Name <= 80 chars, `label_map_version` <= 20 chars, `--base-url` is https and not Hugging Face | Fit the DB columns; model is hosted by us |
| Exported file exists, no external-data sidecar (`*.onnx_data`, `*.data`) | The app downloads one file; a >2 GB export would silently split |
| Size inside the window (default int8 200-500 MB, fp32 900-1600 MB; `--size-range-mb MIN,MAX` overrides) | Catches the wrong model or a truncated export |
| int8 < 50 % of fp32 | Catches quantisation that did not apply |
| Inference on 2 s synthetic audio: finite output, ~99 frames (`(n-400)//320+1`, +/-3), vocab size equals `vocab.json` | Catches a broken graph or the wrong label set |
| fp32 vs int8 argmax agreement on that clip (warns below 50 %) | Coarse only: the real quality gate is the gold-clip benchmark |
| Self-verification of every checksum before the output directory appears | `out/<name>` is only ever complete |

## Try the pipeline without weights

```bash
python export_model.py --backend fake --out /tmp/fake-out && python export_model.py --verify /tmp/fake-out/w2v-espeak-lv60-int8-r1
```

## Benchmark the exported model

```bash
pip install onnxruntime numpy
python3 tools/export_model/benchmark.py out/<name>/<model>.onnx --threads 1,2,4 --check
python3 tools/export_model/benchmark.py out/<name>/<model>.onnx --json bench.json   # keep for the record
```

Prints size and sha-256, load time, latency per clip length and thread count (median, p95, worst, ms per second of
audio, real-time factor), a 15 s estimate against the exit gate (median <= 3 s, worst <= 8 s) and peak memory.
`--check` exits 1 if any thread count breaks the gate. This is the **native CPU** number: the browser runs the model
through WebAssembly, normally single-threaded, typically 2-4x slower, so the per-device answer comes from the
benchmark card at `/dev/calibrate`. The clips are synthetic (latency depends on length, not content); never read
accuracy from this tool. Tests need no onnxruntime (fake session and clock); one test runs the real library
against `web/e2e/fixtures/tiny-ctc.onnx` when it is installed.

## Tests

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m pytest tools/export_model/tests      # 28 tests, no weights, no torch
```

## Not covered here / known limits

- The real `hf` backend (`HFBackend`) has never been run: it needs the weights and packages this repo's sandbox
  lacks. First real run may need an adjustment (`torch.onnx.export` and onnxruntime quantisation APIs move between
  versions); the pinned versions in `requirements.txt` are the starting point, the fake-backend tests cover all other logic.
- Quantisation is dynamic int8 on the whole graph. If accuracy drops on gold clips, try excluding the feature
  encoder or the final projection from quantisation, or ship fp16/fp32 (`--quantize none`).
- The label map (`label_map.json`) is generated from `vocab.json` by a separate step (doc 10 section 4.1); this tool
  only exports and fingerprints the vocab. `--label-map-version` must match the map you generate.
- Re-exporting changes the hash; bump `--release` for every new upload so names stay unique.
