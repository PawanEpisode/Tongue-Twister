# Worker down

The media worker (`worker/`, Fly.io app `worker-moonlit-waterfall-8666`, region `lhr` in `worker/fly.toml`)
transcodes uploads, makes thumbnails and captions. It has no database or storage keys: it claims jobs from the
API (`POST /internal/media/claim/`) with an HMAC signature. While `MEDIA_PROCESSING_ENABLED=0` the API marks
recordings ready without it, so a dead worker only matters when that setting is `1`.

Deploying or rolling back the worker: [worker-deploy-fly.md](worker-deploy-fly.md); smoke test: `worker/scripts/smoke.sh remote`.

## Symptom
- Recordings stay `processing` for more than a few minutes; users see a spinner on `/recordings`.
- Django admin → **Media jobs**: many rows `queued`, none `running`, or the same job `running` with an old lease.
- Fly dashboard shows the machine stopped, crash-looping, or unhealthy.

## Check
1. Is it our side? `curl -s https://<api>/api/health/` should answer `{"status":"ok"}`.
2. Worker alive? `fly status -a worker-moonlit-waterfall-8666` and `fly logs -a worker-moonlit-waterfall-8666`
   (logs are JSON lines; look for `api_call_failed`, `ApiError`, `job_invalid`).
3. Reading the log for the cause:
   - `API returned HTTP 403` on every call: signature rejected. Either `WORKER_SHARED_SECRET` differs between
     Fly and Vercel, the worker clock is off by more than `WORKER_SIGNATURE_MAX_SKEW_S` (300 s), or
     `WORKER_ALLOW_LEGACY_SIGNATURE=0` while an *old* worker image (no `X-Worker-Timestamp`) is still running.
   - `API returned HTTP 503`: the API has no `WORKER_SHARED_SECRET` configured.
   - Connection errors: wrong `API_BASE_URL` (it must include `/api/v1`), or the API is down.
   - Out-of-memory kills: 1 GB VM with 1080p sources; raise `memory` or lower `MEDIA_WORKER_MAX_HEIGHT`.
4. Queue depth (Django shell, or admin filters): `MediaJob.objects.filter(status="queued").count()` and oldest
   `created_at`. A job whose lease lapsed is re-queued automatically (at the next claim, and by `orphan_sweeper`)
   up to `MEDIA_JOB_MAX_TRIES` (3), then it fails.

## Fix
- Crash loop or stopped: `fly machine restart <id> -a worker-moonlit-waterfall-8666` or `fly deploy` from `worker/`.
- Secret mismatch: set the same value on both sides (`secrets-and-rotation.md`), restart the worker.
- Clock skew: the Fly host clock is NTP-synced; if logs show 403 only for some calls, check the API's own
  clock via the `Date` header of any response.
- Signature scheme mismatch right after a deploy: temporarily set `WORKER_ALLOW_LEGACY_SIGNATURE=1` on the API
  (takes effect on the next deploy/restart of the API environment), or redeploy the worker so it sends
  `X-Worker-Timestamp`.
- Cannot fix quickly: set `MEDIA_PROCESSING_ENABLED=0` on the API. New recordings then become ready without
  transcoding (PRD 04 section 10), existing `queued` jobs wait. This is a degrade, not a loss: uploads stay in storage.
- Poison job (one job fails every try): it ends `failed` after 3 tries and the recording is marked failed;
  nothing to do beyond telling the user to re-record.

## Verify
- `fly logs` shows `claim` calls returning and jobs finishing; admin **Media jobs** shows `done`.
- Upload a short test recording on staging/prod with a test account; it reaches `ready`.
- Run the sweep once by hand if a backlog remains: Actions → "Management command" → `orphan_sweeper`.

## Follow-up
- Note queue depth and time-to-clear in the incident file (`incident-template.md`).
- Replay is **not prevented** inside the 300 s signature window (stateless API, no nonce cache); callbacks are
  idempotent, so a replayed `processed` call is harmless. See `secrets-and-rotation.md`.
- If it was out-of-memory or timeouts, record the source size/duration and tune `MAX_JOB_S`, `FFMPEG_THREADS`.

## Scoring jobs (when `SCORING_ENABLED=1`)
The same worker claims scoring jobs (`POST /internal/scoring-jobs/claim/`), alternating with media jobs so neither
starves. If spot-checks or record scoring stall: admin → **Scoring jobs** (`queued` with nothing `running`, or an old
lease). A lapsed lease is re-queued at the next claim and by the `*/10` `sweep_pending_attempts` schedule, up to
`SCORING_JOB_MAX_TRIES` (3); a job whose audio or model is gone is `expired`, and the attempt simply keeps its
device result. Worker log codes: `model_corrupt` (the download failed its sha-256: re-publish the model, the cache is verified on
load), `model_mismatch` / `model_output_invalid` (the model's output does not fit the label map),
`label_map_mismatch` / `label_map_invalid` (the map and the model do not belong together), `onnx_unavailable`
(the image lacks onnxruntime), `job_invalid` (a malformed claim; permanent). A URL outside
`ALLOWED_DOWNLOAD_HOSTS` or over plain http is refused before any download. `audio_mismatch` / `no_speech` /
`low_quality` are inconclusive results, not faults. Stopping scoring without touching media: `SCORING_ENABLED=0`.
