# 13 — Speech engine build spec (A1–A6 and the data questions D)

Binding spec for turning the model-free groundwork (doc 10, rounds 3) into a production speech engine. It **improves on doc 10** where the audit below found gaps; where the two differ, this file wins. Decisions are D33–D41 in `11`. Status is tracked in §9 and in `12`.

Sources: `10` (design), `11` (D3, D8–D10, D15, D29–D31), `12` §2 A/D, code in `api/twisters/speak/`, `web/src/lib/speak/engine/`, `worker/`, `tools/export_model/`.

## 1. Audit: what doc 10 and the round-3 code get wrong or leave out

| # | Finding | Evidence | Fix (decision) |
|---|---|---|---|
| G1 | **Too slow to run anywhere.** Every tested sound runs a CTC pass over the *whole* clip, and the unchanged "base" is recomputed per sound. A 65-word, 15 s read took **19.3 s** in Python (JS would be seconds on a phone). | measured 2026-10-02 | Test on a *neighbourhood* (tested word plus its placed neighbours, union of their windows) and compute the base once per neighbourhood: **0.05 s** (385×), same score. Python and TS changed together, vectors regenerated (D33) |
| G2 | **A spot-check has no audio.** `schedule_spot_check` creates a `ScoringJob` with `audio_asset = NULL`, so a worker could never re-score anything. | `speak/trust.py` | Server *requests* audio for a chosen attempt; the client uploads it (consent-gated) and attaches it; only then is a job queued. No audio, no check, the attempt stays `device` (D34) |
| G3 | **The check is symmetric and score-only.** `abs(worker − device) > 15` flags an honest user whose device was *harsher* than the worker, and a swapped focus sound can hide inside a small score delta. | `apply_job_result` | Flag only **inflation** (device above worker beyond the tolerance) or a **false credit** on a focus word; deflation is a calibration signal, not fraud (D35) |
| G4 | **No queue mechanics for scoring jobs.** There is a result callback but no claim, lease, heartbeat, retry, uniqueness or expiry. A crashed worker leaves `running` forever. | `models.ScoringJob` | Mirror the proven `MediaJob` design: conditional-UPDATE claim with `SKIP LOCKED`, leases, heartbeats, max tries, partial unique index (D36) |
| G5 | **The engine cannot run in the worker.** The worker is a separate package and the engine imports Django models for one enum. | `engine/assess.py` → `..scoring` → `..models` | Make the engine Django-free (`engine/score.py`), vendor it into the worker with a sync script and a drift test (D37) |
| G6 | **Audio integrity is unchecked.** The attempt carries `audio_sha256` but nothing compares it with the clip the worker scores. | n/a | Worker verifies sha-256, duration (±10 %), sample rate and size before scoring; mismatch is `audio_mismatch`, treated as inconclusive and counted (D38) |
| G7 | **Model rollout has no safety net.** A bad model can only be undone by editing rows. | `runbooks/model-rollback.md` | Manifest pins `sha256`; clients and worker verify it; attempts record `model_version` and `scoring_profile`; one `active` row per model; kill switch is the flag; rollback is one admin click (D39) |
| G8 | **Quality gate is described, not specified.** "SNR below threshold" has no number, no estimator and no fixture. | doc 10 §4.9 | §4 defines each gate numerically with a deterministic estimator in both runtimes and shared vectors |
| G9 | **`ɾ` (flap) is mis-specified.** Doc 10 §4.1 maps `ɾ → R "with flap treated separately"`, but a US flapped T/D would read as an R. | doc 10 §4.1 | A separate `DX` class; accent packs decide what it may stand for (en-US: T/D, en-IN: R). Never mapped to R by default (D40) |
| G10 | **No privacy lifecycle for spot-check audio.** | doc 10 §8 | Spot-check audio is deleted when the job settles, unless the user separately saved it; consent `voice_processing` is required; under-13 never (D41) |
| G11 | **No operational signals.** Nothing says whether the engine is healthy or biased. | n/a | §7 metrics, alerts and the fairness gate |
| G12 | **The three "open questions" (D) have no instrument.** | `12` §2 D | §8: a benchmark harness, a gold-set report and a cap-hit report, so each question is answered by a command, not an opinion |

## 2. Architecture (final)

```
        ┌────────────── device (Tier 1, opt-in "Accurate mode") ──────────────┐
mic ─►  capture 16 kHz ─► quality gate ─► Web Worker: ONNX Runtime Web ─► class posteriors
                                                    │                             │
                                            label_map.json                 assess() (TS)
                                                                                  │
                    POST /attempts/ {engine: ondevice, words[], model_version, nonce, audio_sha256}
                                                                                  ▼
                                          API: validate, recompute score, trust=device, maybe request audio
                                                                                  │ (~10 %: audio requested)
                                  client uploads clip (consent) ─► POST /attempts/{id}/spot-check-audio/
                                                                                  ▼
 Fly worker ◄── POST /internal/scoring-jobs/claim/ ◄── ScoringJob(queued) ── API queue (leases, retries)
   ffmpeg → 16 kHz f32 ─► onnxruntime CPU ─► same label map ─► assess() (Python, vendored)
   └── POST …/{id}/result/ {score, words[], model sha, latency} ─► settle: verified | flagged | inconclusive
```

* **One algorithm, three hosts.** Python reference (`api/…/engine`), TypeScript port (`web/…/engine`), vendored Python copy in the worker. All three are pinned by `engine_vectors.json`; the worker copy is additionally pinned byte-for-byte by a drift test.
* **The server never trusts a client score.** It recomputes Score v2 from the reported word verdicts (already true, `device.py`).
* **The worker is a verifier, not a scorer of record.** The user keeps the score they saw; the worker confers `verified` or raises a flag.
* **No fallback hides a failure.** Any device or model problem degrades to Tier 0 with a visible "Basic scoring" badge (doc 10 §10), never to a silently different number.

## 3. Specifications

### 3.1 Engine performance and correctness (D33)
* Substitution and deletion tests use the **neighbourhood**: placed words `w−1…w+1`, frames from the first window's start to the last window's end, labels of those words. `base` is computed once per neighbourhood and passed in.
* If the unchanged sequence is impossible (`base = −∞`) no verdict is derived (all deltas `None`, phoneme stays `ok`/`weak` by peak only). NaN deltas are skipped.
* Budget (measured, Python reference): 65 words / 778 frames / 27 labels ≤ 0.5 s; a regression test asserts ≤ 2 s on CI hardware.
* Engine is **Django-free**: `engine/score.py` holds Score v2 with plain string constants; `speak/scoring.py` wraps it. A test pins that the string constants equal the `WordStatus`/`WordReason` enums.

### 3.2 Label map and model publish (A1, D40)
* Output `label_map.json`:
  ```json
  {"version": "lm1", "blank": "<pad>", "classes": ["<b>", "AA", "…", "DX"],
   "map": {"ʃ": "SH", "t͡ʃ": "CH"}, "drop": ["<s>", "</s>", "<unk>", "|"], "sources": {"vocab_sha256": "…"}}
  ```
  Class 0 is the CTC blank (`<b>`). `DX` is an extra *heard-only* class (the alveolar flap, IPA `ɾ`/`ɽ`, as in American "water"): it is never a target phoneme, and `engine/phones.py` lists it as a neighbour of `T`, `D` and `R`, so a flap heard where a `t`, `d` or `r` was expected is judged as a near sound rather than a different one. A model whose vocabulary has no flap label simply never emits it (`optional_classes` in the rules file).
  The file also carries the model's own `vocab` (label strings in model order). The runtimes use it to check the model's output width and to collapse logits (`label_map.py` writes it; both the web and worker loaders refuse a map whose `vocab` length differs from the model's output).
* Mapping rules are data (`tools/export_model/label_map_rules.json`), not code, so a reviewer can read and amend them. Normalisation: strip stress/length/tie/combining marks, longest match first for affricates and diphthongs.
* **Every vocab label must be mapped or in `drop`.** Anything else makes the tool exit non-zero and print the unknown labels; `--overrides file.json` adds decisions without editing code. This is the guard against a new model silently losing sounds.
* Class posterior: `log p(c) = logsumexp_{ℓ∈c} log p(ℓ)` over the model's own log-softmax; dropped labels contribute nothing (rows need not sum to 1).
* Publishing: `export_model.py` writes `label_map.json` next to the model and lists it in `manifest.json`; storage bucket `models` is public-read, write by service role only; the manifest's `sha256` for the `.onnx` must equal the stored file's.

### 3.3 Scoring-job API (A4, D34–D36)
`ScoringJob` gains: `locked_until`, `max_tries` (3), `worker_id`, `result` (JSON summary), `requested_by_attempt` semantics unchanged. `Attempt` gains `spot_check_requested_at`.

State machine: `queued → running → done | failed`, `running → queued` (lease expiry or retryable failure with tries left), any active → `expired` (attempt deleted, audio purged, model retired). A partial unique index allows one active (`queued|running`) job per `(attempt, kind)`.

| Endpoint | Auth | Behaviour |
|---|---|---|
| `POST /attempts/` (existing) | user | Adds `spot_check: {requested: bool, expires_at}` to the response when the server chose this attempt (rules in D34) |
| `POST /voice/` `{purpose: "spot_check", attempt: <numeric attempt id>, mime_type, size_bytes, duration_ms}` then tus upload and `POST /voice/{uuid}/complete/` `{checksum_sha256}` | user | Mints the clip's upload grant. `voice_asset_id` is a UUID string. The response is `{voice_asset_id, status, expires_at, upload, quota}`. |
| `POST /attempts/{id}/spot-check-audio/` `{voice_asset_id}` (`{id}` is the attempt's numeric id, not its `public_id`) | user | 404 unless owner; 409 `no_request` / `expired`; 422 if the asset is not the caller's ready audio, or its duration differs > 10 % from the attempt, or `audio_sha256` is set and the object's checksum disagrees; 403 `consent_required` without `voice_processing`; 403 `age_required` under 13. Queues the job (idempotent) and sets the attempt `pending` |
| `POST /internal/scoring-jobs/claim/` | HMAC | `{job: null}` when idle, else the payload below under a fresh lease |
| `POST /internal/scoring-jobs/{id}/heartbeat/` | HMAC | extends the lease; 409 `lease_lost` |
| `POST /internal/scoring-jobs/{id}/result/` (existing, extended) | HMAC | idempotent; see settle rules |

Claim payload (everything the worker needs, nothing else; no user id, no email, no transcript):
```json
{"job": {"id": "…", "kind": "spot_check", "lease_s": 120, "max_audio_s": 90,
  "attempt": {"id": "<public_id>", "duration_ms": 14200, "device_score": 91, "audio_sha256": "…",
              "lang": "en-IN", "difficulty": 3},
  "audio": {"url": "<signed GET>", "size_bytes": 412345, "mime": "audio/webm"},
  "model": {"name": "…", "sha256": "…", "url": "…", "size_bytes": 0, "label_map_url": "…"},
  "profile": {"code": "sp-…", "thresholds": {"tau_sub": 3.0}, "accent_packs": {}},
  "twister": {"focus": ["s", "sh"], "words": [{"text": "sells", "variants": [["S","EH","L","Z"]]}]},
  "device_words": [{"i": 0, "status": "correct", "reason": ""}]}}
```
`device_words` is included so the worker can report per-word disagreement without a second call; it never changes how the worker scores.

Result body: `{"status": "done", "score": 0-100, "unscorable": null|"no_speech"|…, "words": [{"i","status","reason"}], "engine_version", "model_sha256", "latency_ms", "quality": {…}}` or `{"status": "failed", "error_code", "retryable": bool}`.

### 3.4 Settling a result (D35)
Let `Δ = device_score − worker_score` (positive = the device was more generous).

| Worker outcome | Attempt becomes | Notes |
|---|---|---|
| `unscorable` (audio unusable) or `audio_mismatch` | `failed` (device result stands), `spot_check_delta = null` | counted in `scoring.inconclusive`; ≥ 3 in 30 days is surfaced to admin, never auto-punished |
| `Δ > SPOT_CHECK_MAX_DELTA` (15) | `failed` + `flagged = true` | counts toward `DEVICE_DISTRUST_AFTER` |
| a focus word is `correct`/`near` on device but `wrong`/`focus_swap` on worker | `failed` + `flagged = true` | false credit on the thing the twister trains |
| otherwise (including `Δ < −15`) | `verified`, `verified_at` set | deflation logged for calibration |

`spot_check_delta` stores the signed `Δ`. Stats are rebuilt (existing behaviour). Idempotent: a repeated result for a settled job returns the stored status.

### 3.5 Worker (A4, D37–D38)
* New job type beside media in the same process; the poll loop alternates (media first, then scoring) so neither starves; each has its own lease/heartbeat.
* Steps: claim → download audio (size cap, timeout, no redirects to other hosts) → verify sha-256 / size → ffmpeg to 16 kHz mono f32 (hard timeout, `-t max_audio_s`) → quality gate → model session (cached on disk by `sha256`, verified on load) → posteriors → label map → `assess` → report.
* `onnxruntime`/`numpy` are imported lazily so media-only deployments and unit tests do not need them. A tiny generated ONNX model exercises the I/O contract in tests; real accuracy is tested only through posterior fixtures.
* Memory: one session per process, `intra_op_num_threads` from config, input length capped; a clip longer than `max_audio_s` is `audio_too_long` (inconclusive).
* Engine copy: `worker/scripts/sync_engine.py` copies the listed engine files; `worker/tests/test_engine_sync.py` fails if the copy differs from `api/twisters/speak/engine/`.

### 3.6 Device engine (A2)
* Opt-in "Accurate mode": explains size, download, that audio stays on the device (except the rare, consented spot-check), and offers "remove model". Never auto-downloads on cellular (`navigator.connection.saveData`/`effectiveType`) without a second confirmation.
* Model cache: Cache Storage keyed by `sha256`; download streams with progress and resume-by-retry; verified before first use; old versions evicted after the new one verifies; storage quota errors become a visible "not enough space" state.
* Device gate: `deviceMemory ≥ 4` (or unknown on Safari with a successful warm-up benchmark), WASM SIMD available, `Worker` + `AudioWorklet` available, secure context, not `saveData`. First run performs a **warm-up benchmark** on a fixed 2 s silent clip; if projected latency for a 15 s clip exceeds `MAX_LATENCY_MS` (8 s) the device is marked `too_slow` for this model version and stays on Tier 0.
* Runtime in a dedicated Web Worker so the UI thread never blocks; cancellation on mode switch/unmount (ties into the existing teardown contract: no tracks, workers or object URLs left).
* Inference over long clips is chunked (30 s max with 1 s overlap, posteriors stitched at the overlap midpoint) so memory stays bounded.
* Fusion with Web Speech text layer follows doc 10 §4.8; the text layer is optional and off in private mode.
* The attempt body adds `engine: "ondevice"`, `model_version`, `scoring_profile`, `nonce`, `audio_sha256`, `quality`, `words[]`; on any API rejection `model_unsupported` the client falls back to Tier 0 and remembers for the session.

### 3.7 Quality gate (§1 G8, both runtimes)
**Speech span (deviation from the first draft, as built).** Both runtimes trim the take to the read before inference: the frames within 30 dB of the 90th-percentile frame level, plus 150 ms of context (`quality.speech_bounds`, pinned by a shared vector). The attempt's `duration_ms` is the *trimmed* length, so speed and fluency judge the read and not the countdown or the reach for the stop button. A spot-check therefore uploads exactly the trimmed 16 kHz mono WAV that was scored; `audio_sha256` is the hash of those bytes, and the worker's ±10 % duration rule compares like with like. The "Too short" gate below is measured against the trimmed span.

All values live in `ScoringProfile.thresholds` with these defaults; measurement is deterministic and covered by shared vectors.

| Gate | Estimator | Default | User message |
|---|---|---|---|
| Too short | speech frames (non-blank argmax) × 20 ms ÷ expected duration | < 40 % | "We only caught part of that — start from the top" |
| Too quiet | RMS of the loudest 30 % frames, dBFS | < −45 dBFS | "Too quiet — move closer" |
| Too noisy | 10th-percentile frame RMS vs 90th, dB (floor vs speech) | < 12 dB | "Too noisy here" |
| Clipping | share of samples with \|x\| ≥ 0.99 | > 1 % | "Too loud — move back a little" |
| Low sample rate | capture rate before resample | < 16 kHz | "This microphone is too low quality" |
| Nothing recognised | blank argmax share | > 0.95 | "We couldn't hear any words" |
| Can't follow | words windowed | < 50 % | "We couldn't follow that read" |
| High entropy | mean entropy on speech frames above the profile limit for > 50 % | profile | "Lots of background sound" |
A failed gate returns no score and is never sent as an attempt; the client may still save a practice session.

### 3.8 Accessibility and fairness
* **Accessibility mode** (setting): completion-based scoring, phoneme verdicts advisory only, no focus gate. Never inferred; always the user's choice.
* The engine abstains (`uncertain`) rather than accuses; `uncertain` never costs score.
* Fairness report (A3) must show, per accent / age band / device class, the false-accusation rate and abstention rate; any group above **1.5×** the overall rate blocks enabling Accurate mode.

## 4. Edge cases added to doc 10 §10

| Case | Behaviour |
|---|---|
| Model file corrupted / partial download / wrong sha | Rejected before use; cache entry deleted; retry offered once, then Tier 0 |
| New model published while a user is mid-session | The session keeps its model; the next run re-reads the manifest |
| Attempt scored with a retired/inactive model | Kept (FK `PROTECT`); a spot-check job for a retired model is `expired` with `model_retired` |
| Manifest fetched while `accurate_mode` is off for that user | `model: null`, client uses Tier 0 and caches the answer ≤ 5 min |
| Two tabs both run the engine | Existing tab lock covers Speak; the model cache is shared and read-only |
| Audio longer than 90 s | Not scored; `audio_too_long` |
| Uploaded clip is not the scored clip | `audio_mismatch` (sha or duration), inconclusive |
| Same audio submitted twice | Existing `audio_sha256` unique index rejects the second; the first stays |
| Worker returns a result after the lease expired and another worker finished | Idempotent: the settled status wins; a late duplicate is ignored |
| Worker result arrives for a deleted attempt / purged account | 404-style no-op, job `expired` |
| Clock skew on the worker | Existing timestamped HMAC (±300 s) |
| `SKIP LOCKED` unavailable (sqlite) | Conditional UPDATE guarantees a single winner |
| User withdraws `voice_processing` consent while a job is queued | Job `expired` (`consent_withdrawn`), audio purged |
| Spot-check requested but the user is offline | Request expires after 30 min; attempt stays `device` |
| Mastery attempt with no audio uploaded | Counts as `device` (trusted unless distrusted) but is excluded from boards once `LEADERBOARD_REQUIRE_VERIFIED=1` |
| Calibration upload contains a minor | Calibration page is staff/allow-list only and requires adult consent per clip |

## 5. Security
Worker endpoints use the existing timestamped HMAC; the claim payload carries no identifiers beyond the attempt's public id; signed audio URLs are short-lived (`MEDIA_WORKER_URL_TTL_S`) and single-purpose; worker downloads refuse non-HTTPS and cross-host redirects; the model URL host is allow-listed in the web CSP; all internal endpoints are exempt from user throttles but capped by body size (64 KB); results are validated field by field (finite numbers, enum statuses, word indexes within the twister).

## 6. Rollout and kill switches (A6)
1. Dark launch: model uploaded, `AcousticModelVersion` inactive, flags off.
2. Internal allow-list: `accurate_mode` for staff only; run the calibration protocol (A3); no `spot_checks`.
3. `spot_checks` on for the allow-list; worker runs; watch §7.
4. Exit gate (§8) passes → `accurate_mode` 10 % → 50 % → 100 % (≥ 3 days each, `15-rollout-and-flags.md`).
5. Only then: `LEADERBOARD_REQUIRE_VERIFIED=1`, `MASTERY_ALLOW_PROVISIONAL=0`, `*/10 sweep_pending_attempts` cron, `weekly_boards` on.
Kill switches, in order of blast radius: `spot_checks` (stops queueing) → `accurate_mode` (clients fall back, API answers `model_unsupported`) → deactivate the model row (manifest empty) → stop the worker app (jobs expire; attempts stay `device`).

## 7. Observability
Structured events (no audio, no transcripts, no user identifiers): `engine.run` (runtime, model, latency_ms, frames, unscorable), `engine.gate_failed` (gate), `engine.model_download` (bytes, ms, result), `scoring_job.claimed|done|failed|expired` (latency, tries), `spot_check.settled` (outcome, Δ bucket). Alerts: queue depth > 50 or oldest queued > 15 min; worker p95 > 20 s; `flagged` rate > 5 % of settled; `inconclusive` rate > 25 %; model download failure > 5 %. Dashboards (PostHog/Sentry already scaffolded) read these.

## 8. Evidence for the open questions (D) and the Accurate-mode exit gate
All three D questions get a command, so the answer is data:

| Question | Instrument | Output |
|---|---|---|
| Does the model meet accuracy on en-IN? | `tools/calibrate/report.py` over the gold set (posterior fixtures + labels) | recall of focus swaps, false-accusation rate on clean reads, per-accent gap, confusion table |
| Model size after int8 and which devices can run it | `tools/export_model/benchmark.py` (offline, onnxruntime) + `/dev/calibrate` in-browser benchmark | size, load time, latency per second of audio, peak memory, per device class |
| Is a paid plan worth building? | `manage.py plan_demand_report` | cap-hit counts by limit (recordings, minutes, bytes), share of active users hitting each, retention vs not, 60-day window |

**Exit gate to enable Accurate mode** (doc 10 §7): focus-swap recall ≥ 85 %, false accusation on clean reads ≤ 5 %, accent gap ≤ 8 points, median device latency ≤ 3 s per 15 s clip (hard ceiling 8 s, §3.6), no group above 1.5× the overall false-accusation rate. The gold set needs ≥ 6 speakers (≥ 3 en-IN), 12–20 twisters each, clips {clean, fast, scripted swap, slur}.

## 9. Work breakdown and status

| Id | Work | Files (new unless marked) | Status |
|---|---|---|---|
| S0 | Local-window tests, cached base, Django-free score | `engine/gop.py`, `engine/assess.py`, `engine/score.py`, TS mirrors, `engine_vectors.json` | see `12` |
| A1 | Label map generator + rules + tests; benchmark tool | `tools/export_model/{label_map.py,label_map_rules.json,benchmark.py}`, `storage_policies.sql` | see `12` |
| A4a | Scoring-job API | `migrations/0020_scoring_job_queue`, `speak/jobs.py`, `speak/views.py`, `urls.py`, `trust.py`, sweeper | see `12` |
| A4b | Worker scoring | `worker/twister_worker/{scoring/,engine/}`, `scripts/sync_engine.py` | see `12` |
| A2 | Device engine | `web/src/lib/speak/engine/runtime/*`, `useAccurateEngine.ts`, `AccurateModePrompt.tsx` | see `12` |
| A3 | Calibration | `web/src/routes/dev.calibrate.tsx`, `tools/calibrate/*`, fixtures | see `12` |
| A5 | Record analysis → attempt | `speak/record_jobs.py`, `media/{analysis,processing}.py`, `speak/{jobs,views,service}.py`, `migrations/0022_record_scoring_job`, `worker/.../scoring/handler.py`, web record review (§3.9) | see `12` |
| D | Evidence tools | `tools/calibrate/report.py`, `tools/export_model/benchmark.py`, `manage.py plan_demand_report`, `QuotaHit` (`migrations/0023_quota_hit`) | see `12` |
| A3 flag | `calibrate` feature flag (seeded off) | `migrations/0021_calibrate_flag` | see `12` |
| A6 | Switches | settings defaults, cron, flags, runbooks | see `12` |


## 14. Record analysis becomes an attempt (A5, as built)

Flow: `POST /recordings/{id}/analyse/` queues the media worker's `analyse` job (16 kHz mono WAV, kept `ANALYSIS_AUDIO_RETENTION_DAYS`). When that audio lands, `speak.record_jobs.enqueue` queues one `ScoringJob(kind=record, recording=…)`. The scoring worker claims it through the same endpoints as a spot-check, scores the audio and reports full device-style `words[]` (with phonemes) and the scored length. The API creates `Attempt(kind=record, engine=worker, verification_status=verified)` through `service.submit`, so XP, streak, stats and achievements behave exactly as for any attempt, and the *server* computes the score from the verdicts.

* **Data model** (`0022_record_scoring_job`): `ScoringJob.attempt` is now nullable; `ScoringJob.recording` is a nullable FK; a check constraint requires exactly one subject (`scoring_job_one_subject`); a partial unique index allows one active record job per recording.
* **Eligibility** (`record_jobs.skip_reason`): `RECORD_SCORING_ENABLED=1`; recording `ready`/`processing`; **no attempt already linked**; analysis audio ready; duration ≤ `SCORING_MAX_AUDIO_S`; `voice_processing` consent still active; an active model and scoring profile exist. Anything else means no job and the recording keeps behaving as before.
* **One attempt per recording, no double XP.** `Recording.attempt` is one-to-one and the attempt's `client_attempt_id` is `uuid5(recording id)`. A take the web already scored live and linked is never enqueued; a result that finds an attempt (client linked one while the job ran) ends `done` with `attempt_exists` and creates nothing. The client's live attempt stays the primary path where the browser can score; the server attempt exists for takes with no attempt (no speech recogniser, muted live text layer, or an analysis requested later).
* **The worker's own audio is never purged by a job.** Settling a record job leaves `Recording.audio_asset` to its expiry (the spot-check clip, by contrast, is deleted on settle, D41).
* **Worker changes.** The claim payload keeps the spot-check shape (`attempt` carries the recording id, `duration_ms`, `lang` from `UserPreference.accent_lang`, `audio_sha256: null`). For `kind=record` the worker: skips the browser-hash proof (the audio is this system's own extraction; size and the asset hash, when present, still apply); accepts a coarse length sanity check (±25 % or 2 s, because webm durations are approximate); trims to `speech_bounds`; scores with `duration_ms = trimmed length`; and returns `words[]` with phonemes, `duration_ms` and `quality`.
* **Inconclusive is not a failure.** `no_speech`, `low_quality`, `could_not_follow`, `audio_mismatch`, `audio_too_long`, `model_mismatch` end the job `done` with that reason; no attempt is created and nothing is flagged.
* **What the client sees.** `analysis.scoring = {status: none|queued|running|scored|unscorable|failed, reason}` on the recording; the web polls while queued/running and explains unscorable reasons in plain words. `reason: too_long` with `status: none` means the take is longer than `SCORING_MAX_AUDIO_S`.

## 15. Evidence tools (D, as built)

| Question | Instrument | How |
|---|---|---|
| Does the model meet the gate on en-IN? | `python tools/calibrate/report.py GOLD_DIR [--profile p.json] [--out r.md] [--json r.json] [--check]` | Replays stored posteriors; prints swap recall, false accusation, accent gap, latency, fairness by group and **refuses to call the gate met without enough evidence** (≥ 6 speakers, ≥ 3 en-IN, ≥ 12 twisters each, all four scenarios, ≥ 1 non-native, no synthetic clips). Clips are recorded at `/dev/calibrate` (flag `calibrate`) |
| Model size and speed? | `python tools/export_model/benchmark.py MODEL.onnx [--threads 1,2,4] [--check]` | Native onnxruntime: size, sha-256, load time, latency per clip length and thread count, 15 s estimate against the 3 s / 8 s gate, peak memory. The browser number comes from `/dev/calibrate` (benchmark card) |
| Is a paid plan worth building? | `python manage.py plan_demand_report [--days 60] [--json]` (also in the *Management command* workflow) | Cap hits by limit, share of active users and savers hitting each, retention with versus without a cap hit; says plainly when there are too few users to mean anything |

`plan_demand_report` reads `QuotaHit`, one row per user, limit and 10-minute window, written best-effort by the API's error handler whenever a request is refused with `402 quota_exceeded`; it holds no content, and is pruned after `QUOTA_HIT_RETENTION_DAYS` (90) by `prune_generation_usage`. **There is no history before this ships**: the 60-day clock starts at deploy.
