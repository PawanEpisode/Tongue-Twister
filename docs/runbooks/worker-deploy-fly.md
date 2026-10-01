# Deploy the media worker on Fly.io

First-time setup, routine redeploys, scaling and rollback for `worker/` (app `worker-moonlit-waterfall-8666`,
region `lhr`, config `worker/fly.toml`). Run every command from a trusted machine with
[flyctl](https://fly.io/docs/flyctl/install/) installed. For a worker that is already deployed and misbehaving
use [worker-down.md](worker-down.md); for secret rotation see [secrets-and-rotation.md](secrets-and-rotation.md).

What the worker is: one container (Python + ffmpeg) that **listens on no port**. It polls the API over HTTPS,
signs every call with `WORKER_SHARED_SECRET`, downloads and uploads through signed storage URLs the API hands it.
So it needs exactly two secrets and nothing else:

| Setting | Where | Value |
|---|---|---|
| `API_BASE_URL` | Fly secret | The API origin **plus `/api/v1`**, no trailing slash, e.g. `https://api.example.com/api/v1` |
| `WORKER_SHARED_SECRET` | Fly secret **and** the API's Vercel project | Same random string on both sides |
| Storage keys | **not on Fly** | The worker has no Supabase key. `SUPABASE_SERVICE_ROLE_KEY` lives only on the API (Vercel) |
| Database URL | **not on Fly** | Same: the worker has no database access |
| `POLL_INTERVAL_S`, `FFMPEG_THREADS`, `LOG_LEVEL`, `SHUTDOWN_GRACE_S` | `fly.toml` `[env]` | Already set (15, 1, INFO, 20). Others (`MAX_JOB_S`, `WORK_DIR`, ...) are optional and listed in `worker/README.md` |

## Before you start
- [ ] The API is deployed with the timestamped-signature verifier and `MEDIA_PROCESSING_ENABLED` decided
  (`0` = recordings become ready without a worker; set it to `1` only after step 6 passes).
- [ ] The API answers: `curl -s https://<api>/api/health/` returns `{"status":"ok"}`.
- [ ] You know the API's `WORKER_SHARED_SECRET` (Vercel -> api project -> Settings -> Environment Variables),
  or you are about to create one (step 3).
- [ ] Worker checks pass locally: `cd worker && uv run ruff check && uv run python -m pytest`.

## First deploy

### 1. Log in and create the app
```bash
fly auth login
fly apps list | grep worker-moonlit-waterfall-8666 || fly apps create worker-moonlit-waterfall-8666
cd worker            # every following command runs here, where fly.toml and the Dockerfile are
```
The name is the `app` line in `fly.toml`. To use a different name, change that line and every `-a` below
(and the names in `worker-down.md`, `deploy-and-rollback.md`, `secrets-and-rotation.md`).

### 2. Do **not** create a volume
The worker is stateless: per-job scratch goes to `/tmp` on the machine's root disk and is deleted after each
job (it needs about 3x the source size; sources are capped at 200 MB). `fly volumes list -a worker-moonlit-waterfall-8666`
should print nothing. A volume would also pin the machine to one host and block replicas. Machines are
ephemeral; losing one loses nothing because job leases expire and the API re-queues.

### 3. Generate (or reuse) the shared secret
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"      # new secret, copy it once
```
If the API already has `WORKER_SHARED_SECRET`, reuse that exact value instead. A new one must be set on the API
too (step 3b) before the worker can authenticate.

### 3a. Set the Fly secrets (staged, applied by the first deploy)
```bash
fly secrets set --stage -a worker-moonlit-waterfall-8666 \
  API_BASE_URL='https://<api-domain>/api/v1' \
  WORKER_SHARED_SECRET='<the secret>'
fly secrets list -a worker-moonlit-waterfall-8666      # names and digests only; values are never shown
```
Shell history keeps the secret: prefer `read -rs S && fly secrets set --stage -a worker-moonlit-waterfall-8666 WORKER_SHARED_SECRET="$S"; unset S`.

### 3b. Set the same secret on the API (only if you created a new one)
Vercel -> api project -> Settings -> Environment Variables -> add `WORKER_SHARED_SECRET` (Production), then
**redeploy the API** (env changes need a new deployment). Until then the API answers the worker with 503.

### 4. Deploy exactly one machine
```bash
fly deploy --ha=false -a worker-moonlit-waterfall-8666
```
`--ha=false` stops Fly from creating a second machine by default; add replicas on purpose in the scaling section.
The first build is remote (Fly's builder), takes a few minutes, and installs ffmpeg in the image.

### 5. Confirm it is running
```bash
fly status -a worker-moonlit-waterfall-8666          # one machine, state "started"
fly logs -a worker-moonlit-waterfall-8666            # JSON lines; expect claim polling every ~15 s, no errors
```

### 6. Smoke test
```bash
export API_BASE_URL='https://<api-domain>/api/v1'
export WORKER_SHARED_SECRET='<the secret>'
worker/scripts/smoke.sh remote          # from the repo root
```
It checks the API health endpoint, sends a **signed heartbeat for a random job id** (the API must answer 404/409/410, so
the signature and clock are accepted without touching a real job), checks that a Fly machine is `started`, and scans
recent logs for `HTTP 403` / `HTTP 503` / `ConfigError` / out-of-memory. Then do one real check: with
`MEDIA_PROCESSING_ENABLED=1`, record a short clip on a test account; Django admin -> **Media jobs** shows the job
move `queued` -> `running` -> `done` and the recording reaches `ready`.
`worker/scripts/smoke.sh local` builds the image and runs it against a fake API (needs Docker); use it before a
risky Dockerfile change.

## Health checks and liveness
There is no HTTP port, so Fly's http/tcp machine checks do not apply, and **Fly ignores the Dockerfile
`HEALTHCHECK`** (Docker, Compose and Render honour it). Liveness on Fly is therefore:
- `[[restart]] policy = "always"` in `fly.toml` restarts a crashed process;
- `fly status` (machine state), `fly logs` (polling lines), and the app-level view in the API (admin -> Media jobs,
  or `smoke.sh remote`);
- a manual probe of the same marker the Docker healthcheck reads:
  `fly ssh console -a worker-moonlit-waterfall-8666 -C "python -m twister_worker.health"; echo $?` (0 = healthy; the
  runner touches the file every loop tick and job heartbeat, stale after 120 s).
A hung-but-running process is only caught by queue age (jobs sitting `queued`), so watch it
(`worker-down.md`).

## Logs
```bash
fly logs -a worker-moonlit-waterfall-8666                 # live tail
fly logs -a worker-moonlit-waterfall-8666 --no-tail       # recent buffer
fly logs -a worker-moonlit-waterfall-8666 | grep -E '"level": ?"(ERROR|WARNING)"'
```
Signed URLs, tokens and signatures are never logged. Fly keeps a short buffer only; ship logs elsewhere
(Fly log shipper) if you need history.

## Regions, scaling, size
- Region: `primary_region = 'lhr'` in `fly.toml`. The worker is latency-insensitive but moves large files, so
  pick the region nearest the **Supabase storage region** to cut transfer time (`fly platform regions` lists
  codes). Changing it: edit `primary_region`, then `fly machine clone <id> --region <new> -a worker-moonlit-waterfall-8666`
  and `fly machine destroy <old-id> --force -a worker-moonlit-waterfall-8666`.
- Replicas: the queue is lease-based (`SELECT ... FOR UPDATE SKIP LOCKED`), so add machines freely, each runs one job
  at a time: `fly scale count 2 -a worker-moonlit-waterfall-8666` (or `--region lhr`). Scale back with
  `fly scale count 1`. Cost is per running machine; there is no autoscaling on a pull worker, so set the count by hand
  from the queue depth.
- Size: `shared-cpu-1x`, 1 GB, `FFMPEG_THREADS=1` is the starter. For 1080p sources or `out of memory` in the logs:
  `fly scale vm shared-cpu-2x --vm-memory 2048 -a worker-moonlit-waterfall-8666`, then set `FFMPEG_THREADS=2` in
  `fly.toml` `[env]` and `fly deploy` (match threads to vCPUs). Alternatively lower `MEDIA_WORKER_MAX_HEIGHT` on the API.
- Idle API traffic: raise `POLL_INTERVAL_S` (currently 15 s; lower means faster pick-up, more API calls).

## Routine redeploy
```bash
cd worker
uv run ruff check && uv run python -m pytest        # must pass first
fly deploy --ha=false -a worker-moonlit-waterfall-8666    # keep --ha=false while you run one machine
fly status -a worker-moonlit-waterfall-8666
worker/scripts/smoke.sh remote                      # from the repo root, with the two env vars exported
```
Fly stops the old machine with SIGTERM and waits `kill_timeout` (30 s); the worker stops claiming, gives the
running job `SHUTDOWN_GRACE_S` (20 s) and then abandons it **without reporting**, so the API re-queues it after the
lease. A deploy mid-job costs a re-run, not a lost recording. Keep `SHUTDOWN_GRACE_S` < `kill_timeout`.

## Signature cut-over (`WORKER_ALLOW_LEGACY_SIGNATURE`) migration plan
The API default is `WORKER_ALLOW_LEGACY_SIGNATURE=1`: it still accepts the **old** body-only signature (no
`X-Worker-Timestamp`) so the API and worker can be deployed in either order. The current worker image always sends
the timestamp. The flag lives on the **API** (Vercel), never on Fly. Once the deployed worker is the timestamped one,
close the legacy path:
1. API deployed with the timestamp verifier (legacy still `1`).
2. Worker deployed from this commit (steps above). `fly logs` shows claims, no `HTTP 403`; one real job reaches `done`.
3. Run `worker/scripts/smoke.sh remote` (the probe is timestamped, so it passes under both settings).
4. Vercel api project: set `WORKER_ALLOW_LEGACY_SIGNATURE=0`, **redeploy the API**, run the smoke test and one real
   job again.
5. Rollback of the flag: set it back to `1` and redeploy the API. **Never roll the worker back to an image older
   than the timestamp change while the flag is `0`**: every call is rejected with 403 (`worker-down.md`).
The same sequence is in `deploy-and-rollback.md` (section "Worker signature cut-over").

## Rollback
```bash
fly releases -a worker-moonlit-waterfall-8666                 # version list, newest first, with status
fly releases -a worker-moonlit-waterfall-8666 --image         # same, with the image reference of each
fly deploy --ha=false -a worker-moonlit-waterfall-8666 --image <registry.fly.io/worker-moonlit-waterfall-8666:deployment-...>
```
Or redeploy the previous commit: `git checkout <good-sha> -- worker && fly deploy --ha=false -a worker-moonlit-waterfall-8666`.
Secrets are not part of a release image, so a rollback keeps the current secrets. After rolling back, run
`worker/scripts/smoke.sh remote`. A rollback never touches the API; if the API side is the problem use
`deploy-and-rollback.md`. If you cannot fix it in minutes, degrade instead: set `MEDIA_PROCESSING_ENABLED=0` on
the API (recordings are marked ready without transcoding; queued jobs wait).

## Stop, pause, tear down
```bash
fly machine stop <id> -a worker-moonlit-waterfall-8666      # pause: jobs just queue (restart policy only applies to crashes)
fly machine start <id> -a worker-moonlit-waterfall-8666
fly apps destroy worker-moonlit-waterfall-8666              # permanent; ask first
```
Set `MEDIA_PROCESSING_ENABLED=0` on the API before a long pause.

## Verify (done when)
- `fly status` shows the machine(s) `started`; `smoke.sh remote` prints `SMOKE OK`.
- A real test recording becomes `ready` and the admin Media job is `done`.
- `fly secrets list` shows `API_BASE_URL` and `WORKER_SHARED_SECRET`, and the API has the same secret.

## Follow-up
- Record the release and the image (`fly releases --image`) in `docs/features/12-implementation-status.md`.
- If sizing changed, update `worker/fly.toml` and the numbers above in the same commit.
- Not verified here: the flyctl commands and flags were written from flyctl's documented behaviour without
  running them, and the image has never been built by Fly. If a flag is rejected, `fly <command> --help` wins and
  this runbook is the bug.
