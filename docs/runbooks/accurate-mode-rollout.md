# Turning on Accurate mode (and everything that depends on it)

Nothing here is switched on by code. Each step has a **check** that must pass before the next one, and a
**way back**. Do them in order; stop at the first check that fails. Spec: `docs/features/13` (§6 rollout, §8
exit gate, §14 record analysis). Rolling a bad model back: [model-rollback.md](model-rollback.md).

## 0. Before anything: the model exists and is the one you tested

1. On a Mac with ~2 GB free: `python tools/export_model/export_model.py ...` (see `tools/export_model/README.md`),
   then `python tools/export_model/label_map.py` on the model's real `vocab.json`.
   **Check:** it exits 0. Any unmapped label makes it exit non-zero and list the labels; add them to
   `label_map_rules.json` (or `--overrides`), never ignore them.
2. Upload the `.onnx` and `label_map.json` to the public `models` bucket (re-run `storage_policies.sql` first).
3. Register it **inactive**: `python manage.py publish_acoustic_model out/<name>/manifest.json` run with the
   production `DATABASE_URL` in that one shell (the *Management command* workflow cannot carry a manifest, so the
   command is not on its allow-list), or create the row in the Django admin from `manifest.json`.
   **Check:** the row's `sha256` equals the uploaded file's and `download_url` is our own https storage. It is
   not `active` yet: nothing uses it.
4. **Check:** `python tools/export_model/benchmark.py model.onnx --check` on a normal laptop passes the 3 s / 8 s
   gate. (A phone is slower; step 2 below measures the device that matters.)

## 1. Prove accuracy (the exit gate). No flag changes yet

1. Allow-list yourself on the `calibrate` flag (Django admin → Feature flags → `calibrate` → *Allow list* = your
   profile id; the migration seeds it **off** and never resets it).
2. Record the gold set at `/dev/calibrate` on real phones and laptops: **≥ 6 speakers, ≥ 3 with en-IN, ≥ 12
   twisters each, all four scenarios (clean, fast, scripted swap, slur), ≥ 1 non-native speaker.** Everyone must
   consent (the page asks). Export one JSON per speaker into a folder outside the repo.
3. `python tools/calibrate/tune_thresholds.py GOLD_DIR --out profile.json` (precision first), then
   `python tools/calibrate/report.py GOLD_DIR --profile profile.json --check`.
   **Check:** exit 0. That means swap recall ≥ 85 %, false accusation on clean/fast reads ≤ 5 % per word,
   accent gap ≤ 8 points, median latency ≤ 3 s per 15 s (worst ≤ 8 s) and no group above 1.5x the overall
   false-accusation rate. The report also says whether the **evidence** is enough; synthetic clips never count.
4. Create the tuned `ScoringProfile` row in the admin (active, linked to the model, `profile.json`'s thresholds).
5. Activate the model: `python manage.py publish_acoustic_model --activate <manifest.json>`. It refuses without an
   active scoring profile (or `--bootstrap-profile`, which would use untuned defaults: do not use it for launch),
   and retires the previously active model. The manifest still serves `null` to users while `accurate_mode` is off.
**Way back:** `active=false` on the model row in the admin.

## 2. Worker with scoring

1. Fly: create a volume for models (`MODEL_DIR`, e.g. `/data/models`, ≥ 1 GB), set `SCORING_ENABLED=1`,
   `ALLOWED_DOWNLOAD_HOSTS=<your Supabase host>`, optionally `ONNX_THREADS` (default 2), `MAX_MODEL_BYTES`,
   `MAX_SCORING_AUDIO_BYTES` (see `secrets-and-rotation.md`). Memory: the int8 model needs about 1 GB; use at least
   2 GB for the VM.
2. `fly deploy` ([worker-deploy-fly.md](worker-deploy-fly.md)).
   **Check:** `fly logs` shows the model downloading once, then `job_started kind=...` when a job exists, and
   the health file is fresh.
**Way back:** set `SCORING_ENABLED=0`; queued jobs wait (and expire, harmlessly, if the audio or model goes).

## 3. Spot-checks (server verification of device results)

1. Enable flag `spot_checks` for the allow-list only (10 % rollout next, then 100 %, at least 3 days each;
   `15-rollout-and-flags.md` §3).
2. **Check:** after a device attempt, the response has `spot_check.requested`, a job appears in admin →
   *Scoring jobs*, goes `queued → running → done`, and the attempt becomes `verified`. Watch the settle log
   lines: `scoring.jobs_swept`, `spot_check.settled flagged=… delta_bucket=…`.
3. Alerts to watch (doc 13 §7): `flagged` > 5 % of settled, `inconclusive` > 25 %, queue older than 15 min.
**Way back:** untick `spot_checks`. Pending attempts keep their device result; the `*/10` sweeper settles them.

## 4. Accurate mode for users

1. Enable `accurate_mode` for the allow-list, then 10 %, 50 %, 100 %.
2. **Check on a real phone:** Settings prompt shows the size, downloads with progress, a read gets a score, a
   deliberate swap is caught, and a second visit reuses the cached model. `GET /engine/manifest/` returns the
   model while the flag is on and `null` when it is off.
**Way back:** untick `accurate_mode`. Clients see `model: null` (or `422 model_unsupported` on submit) and fall
back to basic scoring for the session; nothing is lost.

## 5. Record analysis scoring

1. `RECORD_SCORING_ENABLED=1` on the API (Vercel env). Requires steps 2 and 3, `MEDIA_PROCESSING_ENABLED=1`,
   and `record_cloud` on.
2. **Check:** analyse a saved take that has no attempt; admin shows a `record` scoring job, then
   `recording.attempt` is set with `engine=worker`, `verification_status=verified`; the page shows "Your take was
   scored". Analysing a take that already has an attempt creates no job and no second XP.
**Way back:** `RECORD_SCORING_ENABLED=0`. Existing attempts stay.

## 6. Tighten trust (only after step 3 has run cleanly for a week)

`LEADERBOARD_REQUIRE_VERIFIED=1`, `MASTERY_ALLOW_PROVISIONAL=0`, flag `weekly_boards`, and last
`WORKER_ALLOW_LEGACY_SIGNATURE=0` (confirm the worker image sends `X-Worker-Timestamp` first;
`deploy-and-rollback.md`). Each is a config flip with the opposite value as its way back.

## What is already on

The `*/10` `sweep_pending_attempts` schedule in *Management command* is enabled and harmless without jobs.
`plan_demand_report` has been collecting cap-hit evidence since the API shipped `QuotaHit` (60 days of data
needs 60 days).
