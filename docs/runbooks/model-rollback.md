# Model rollback

**No acoustic model ships yet.** `AcousticModelVersion` has no active row and the `accurate_mode` flag is off
(seed: migration `0003`), so `GET /engine/manifest/` offers none and scoring uses the browser's speech result
plus the server's text alignment. Nothing below needs doing today; this is the procedure for the day one ships.

What controls a model (all in code):
- `accurate_mode` flag: `speak/serializers.py` rejects `engine=accurate` (error `model_unsupported`, 422) when
  off for the user, and `speak/views.py` hides the model from the manifest. It is the **kill switch**.
- `AcousticModelVersion.active`: the manifest (`GET /engine/manifest/`) serves the active row
  (`name`, `sha256`, `download_url`, `label_map_version`) plus its active `ScoringProfile`.
- `spot_checks` flag: server re-scoring of device results (`speak/trust.py`) against the active model.

## Symptom
Score complaints after a model release, low-confidence rate or "couldn't hear you" jumping, spot-check
disagreement rising (`DEVICE_DISTRUST_AFTER` starts distrusting devices), p95 attempt latency up.

## Check
1. Which model is live: admin → **Acoustic model versions** (the one with `active` ticked) and
   `curl https://<api>/api/v1/engine/manifest/`.
2. Compare attempts by `model_version` before and after the release date (admin → Attempts, filter).
3. Is it the model or the client? Reproduce with `accurate_mode` off for your own account (allow-list).

## Fix (fastest first)
1. **Stop new use:** Django admin → Feature flags → `accurate_mode` → untick *enabled*. The flags endpoint is
   cached for 60 s (`Cache-Control: private, max-age=60`) and the web app refreshes every 60 s, so allow ~2 min.
   Users fall back to basic scoring; no data is lost.
2. **Stop server re-scoring if it is the problem:** untick `spot_checks`. Pending verifications age out through
   `sweep_pending_attempts` (retry once, then `failed`; the device result stands).
3. **Roll the manifest back:** in admin, tick `active` on the previous `AcousticModelVersion` and untick the bad
   one (the manifest serves the first active row ordered by newest `released_at`, so make sure only one is ticked). Keep the bad row for audit; do not delete
   it, attempts reference it.
4. Browsers cache the model by `sha256`; the rolled-back manifest points them at the previous hash, so no cache clear.

## Verify
- `GET /engine/manifest/` shows the previous `name`/`sha256` (or no model when `accurate_mode` is off).
- A test attempt as an allow-listed user completes and carries the expected `model_version`.
- Complaint rate and low-confidence rate recover over the next hours.

## Follow-up
- Staged rollout for the next model uses the `accurate_mode` rollout percentage (see `15-rollout-and-flags.md`).
- Add the failing clips to the calibration gold set (`10-in-house-pronunciation-engine.md`) before retrying.
- Update `docs/features/12-implementation-status.md` and the decisions log.
