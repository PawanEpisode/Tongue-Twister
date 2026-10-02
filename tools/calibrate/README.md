# calibrate: does the engine meet the Accurate-mode exit gate?

Offline tools over **stored posteriors** (the model's log-probabilities for a recorded clip), so changing a
threshold is judged in seconds and nobody re-records. Standard library only; the scoring itself is the API's
Django-free engine (`api/twisters/speak/engine`). Spec: `docs/features/13` §3.8 and §8, procedure in
`docs/runbooks/accurate-mode-rollout.md`.

```bash
python3 -m pytest tools/calibrate/tests                           # 37 tests
python3 tools/calibrate/report.py GOLD_DIR --profile profile.json --out report.md --check
python3 tools/calibrate/tune_thresholds.py GOLD_DIR --out profile.json
python3 tools/calibrate/fairness.py GOLD_DIR                      # the by-group table on its own
```

## Recording the gold set

Open `/dev/calibrate` (flag `calibrate`, signed in) with Accurate mode ready. For each scripted prompt the page
records, scores locally and keeps the posteriors: **clean**, **fast**, **swap** (a scripted focus-sound swap on a
named word) and **slur**. Declare the speaker honestly (accent, age band, native or not, device class): fairness
is measured by those labels. Everyone recorded must consent; export one JSON per speaker (a file is one clip or
`{"clips": [...]}`). Keep the files out of the repo: they are people's voices, even without audio. Needed:
**>= 6 speakers, >= 3 en-IN, >= 12 twisters each, all four scenarios, >= 1 non-native speaker**.

## Clip format (schema 1)

`{schema, id, consent: true, synthetic?, speaker{id, accent, age_band, native, device_class}, scenario, swap_word,
twister{slug, focus, difficulty, words[{text, variants}]}, posteriors{vocab, frames, logp_f16}, duration_ms,
latency_ms?, model?, quality?}`. `logp_f16` is base64 little-endian float16 of the (frames x vocab) matrix,
clamped to [-60, 0]. A clip without `consent: true` is rejected on load.

## What the report decides

Swap recall >= 85 %; false accusation on clean and fast reads <= 5 % per word; accent gap <= 8 points; median
latency <= 3 s per 15 s of audio (worst <= 8 s); no group above 1.5x the overall false-accusation rate (groups
with fewer than 100 scored words are listed but cannot fail the gate). **It also says whether the evidence is
sufficient**, and `--check` exits non-zero if it is not. Synthetic clips (`fixtures/synthetic/`, made by
`make_synthetic_gold.py`) exercise the tooling and count as no evidence.

`tune_thresholds.py` does coordinate descent over `tau_sub`, `tau_del`, `tau_uncertain` and `tau_weak`, precision
first (it will give up recall before it accuses a correct reader), and refuses synthetic clips without
`--allow-synthetic`. `tests/test_gold_regression.py` freezes the synthetic report; `UPDATE_GOLD=1` rewrites it
when the engine changes on purpose.
