# Twister media worker

A stateless container that turns uploaded recordings into playable, shareable media. It has **no
database access and no storage keys**: it only knows `API_BASE_URL` and a shared HMAC secret.

```
claim ─► download source (signed GET) ─► ffprobe/ffmpeg ─► upload outputs (signed PUT) ─► report
```

| Job kind | Outputs |
|---|---|
| `process` | H.264/AAC MP4 (faststart, <= `limits.max_height`, loudness-normalised) - **skipped entirely** when the upload is already an H.264/AAC MP4 within the height and duration caps; if only the audio is non-AAC the video stream is copied. JPEG thumbnail at 25 %, WebVTT captions from `words[]` |
| `analyse` | 16 kHz mono PCM WAV for the later scoring step |

The thumbnail and captions are best effort (a failure is logged and omitted from the report); a
failed transcode/audio step fails the job. The worker is portable (decision D15): any host that can
run one Linux container and reach the API over HTTPS will do.

## API contract it relies on (build spec A2.2)

All calls are `POST` with a JSON body, `X-Worker-Timestamp: <unix seconds>` and `X-Worker-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>." + raw_body)>` (signed afresh on every retry; the API rejects clock skew over 300 s),
relative to `API_BASE_URL` (which **includes** `/api/v1`).

| Call | Body | Notes |
|---|---|---|
| `/internal/media/claim/` | `{}` | `200 {"job": null}` or `{"job": {id, kind, recording_id, asset_id, lease_s, source:{url,mime,size_bytes}, outputs:{mp4?,thumbnail?,captions?,audio?:{path,upload_url,token,mime}}, words:[{target,start_ms,end_ms,status}]\|null, limits:{max_height,max_s}}}` |
| `/internal/media/jobs/{id}/heartbeat/` | `{}` | every `lease_s / 3` (min 1 s); `404/409/410` means the lease is gone and the worker abandons the job without reporting |
| `/internal/media/{asset_id}/processed/` | `{job_id, status: "ready"\|"failed", outputs:[slot,...], duration_ms?, width?, height?, error?, retryable?}` | idempotent. `outputs` lists the slots actually uploaded (`mp4` is omitted when the upload was already a compliant H.264/AAC MP4 and was not re-encoded). The API stats each output itself, so no paths or sizes are sent. Permanent failures (`source_too_large`, `no_video_stream`, `probe_failed`, `job_invalid`, `output_too_large`, `output_empty`) send `retryable: false` |

Uploads are a plain `PUT upload_url` with the raw bytes and `Content-Type: mime`; the signed URL
already carries its token and permits overwrite, so a rerun simply replaces the object. The
signing algorithm is pinned by [`tests/hmac_vector.json`](tests/hmac_vector.json), which the API
tests can load too.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | required | e.g. `https://api.example.com/api/v1` |
| `WORKER_SHARED_SECRET` | required | same value as the API's `WORKER_SHARED_SECRET` |
| `POLL_INTERVAL_S` | `5` | sleep when the queue is empty (errors back off exponentially, max 60 s) |
| `MAX_JOB_S` | `900` | hard wall-clock budget per job (downloads, ffmpeg, uploads) |
| `FFMPEG_THREADS` | `2` | threads per ffmpeg process; match the container's vCPUs |
| `LOG_LEVEL` | `INFO` | `DEBUG`/`INFO`/`WARNING`/`ERROR` |
| `WORKER_ID` | hostname | sent on claim, appears in API logs |
| `WORK_DIR` | system temp | per-job scratch directory (removed after each job); needs ~3x the source size |
| `HEALTH_FILE` | `/tmp/twister-worker.alive` | liveness marker read by the Docker `HEALTHCHECK` |
| `MAX_DOWNLOAD_BYTES` | `209715200` | ceiling for source downloads (the job's `source.size_bytes` is the tighter cap) |
| `MAX_UPLOAD_BYTES` | `209715200` | ceiling for output uploads (`limits.max_output_bytes` if lower) |
| `SHUTDOWN_GRACE_S` | `20` | on SIGTERM, how long a running job may finish before it is abandoned |

## Run and test locally

```bash
cd worker
uv venv --python 3.12 && uv pip install -r requirements-dev.txt
uv run ruff check && uv run ruff format --check
uv run python -m pytest        # needs ffmpeg on PATH for the integration tests, else they skip
API_BASE_URL=http://localhost:8000/api/v1 WORKER_SHARED_SECRET=dev uv run python -m twister_worker
```

Docker (build context is `worker/`):

```bash
docker build -t twister-worker worker/
docker run --rm -e API_BASE_URL=... -e WORKER_SHARED_SECRET=... twister-worker
```

## Deploy

The worker listens on no port; it only makes outbound HTTPS calls. Set `API_BASE_URL` and
`WORKER_SHARED_SECRET` as secrets on the platform, and set the same secret on the API.

- **Render**: create a *Background Worker* from the repo, runtime Docker, root directory `worker`,
  Dockerfile path `./Dockerfile`. Start with the Starter plan (0.5 CPU / 512 MB) and set
  `FFMPEG_THREADS=1`; move to 1-2 vCPU for 1080p. Render sends SIGTERM and waits 30 s, so keep
  `SHUTDOWN_GRACE_S` below that.
- **Fly.io**: follow `docs/runbooks/worker-deploy-fly.md` (app create, secrets, `fly deploy --ha=false`, smoke test
  `scripts/smoke.sh`, rollback). `fly.toml` already has no `[http_service]`, `kill_signal`/`kill_timeout` for graceful
  stops, and 1 shared vCPU / 1 GB. Fly ignores the Dockerfile `HEALTHCHECK`.
- **Cloud Run**: use a *worker pool* (or a service with `--no-cpu-throttling`, `--min-instances=1`
  and an unused port; a plain request-driven service will be throttled between requests and is a
  poor fit). Use 2 vCPU / 2 GiB, `--max-instances` to cap cost, and a task/pool timeout above
  `MAX_JOB_S`. Cloud Run only waits about 10 s after SIGTERM, so set `SHUTDOWN_GRACE_S=8`
  (an interrupted job is simply re-queued).

> The Dockerfile and these recipes were written without a Docker build or a real deployment; follow
> each platform's current docs for exact flags.

## Scaling

The queue is the API's `MediaJob` table; claims use `SELECT ... FOR UPDATE SKIP LOCKED` plus a lease,
so **add replicas freely**: each runs one job at a time. Size by the slowest expected job
(roughly real-time x0.5 on 1 vCPU for 720p H.264 `veryfast`). Scale to zero is fine if you accept
the cold start; otherwise keep one warm replica. Raise `POLL_INTERVAL_S` to cut idle API traffic.

## Failure modes

| Situation | Behaviour |
|---|---|
| Processed call answers `409 upload_incomplete` / `410` | logged; the lease expires and the job is re-run (409) or dropped (410) |
| API unreachable / 5xx | retried with backoff (claims keep retrying forever with capped backoff); a finished job's report is retried, then logged if still failing - the lease expires and the job is re-run (outputs are overwritten, the callback is idempotent) |
| SIGTERM | stop claiming, let the current job finish for `SHUTDOWN_GRACE_S`, then abandon it **without reporting**; the API re-queues after the lease |
| Heartbeat rejected (lease lost) | job is cancelled and nothing is reported |
| Worker killed mid-job | lease expires, API re-queues (up to `max_tries`) |
| Source too large / not a video / ffmpeg error / timeout | reported `failed` with one of `source_too_large`, `no_video_stream`, `probe_failed`, `ffmpeg_failed`, `ffmpeg_timeout`, `job_timeout` |
| Storage download/upload error | retried, then `source_download_failed` / `upload_failed` |
| Output larger than the cap | `output_too_large` |
| Malformed claim payload | `job_invalid` (rejected before any work) |
| Anything unexpected | `internal_error`; details are in the logs by exception type only |

Logs are JSON lines on stdout. Signed URLs, upload tokens and signatures are never logged
(`httpx` request logging is silenced and error messages carry status codes / exception types only).
