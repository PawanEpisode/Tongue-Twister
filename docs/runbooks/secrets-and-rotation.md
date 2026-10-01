# Secrets and rotation

Where each variable is set: **Vercel (API)**, **Vercel (web)**, **GitHub `production` environment** (used by
`.github/workflows/manage-command.yml`; the web CI needs none), **Fly** (`fly secrets set -a
worker-moonlit-waterfall-8666 NAME=value`; plain values in `worker/fly.toml` `[env]`). Names come from
`api/config/settings.py`, `api/.env.example`, `web/.env.example`, `worker/twister_worker/config.py` and the
workflow; a test (`api/tests/test_runbooks.py`) fails if a settings variable is not listed in this file.

Rule of thumb: Vercel env changes need a **new deployment** to apply; Fly secrets restart the machines; GitHub
secrets apply on the next workflow run.

## Secrets (rotate on suspicion of exposure; never log or commit)
| Variable | Set in | What it does | Rotating it breaks |
|---|---|---|---|
| `DJANGO_SECRET_KEY` | Vercel API, GitHub prod | Django signing (including reminder unsubscribe tokens), default `IP_HASH_SALT` | Admin sessions (log in again). If `IP_HASH_SALT` is unset, stored IP hashes stop matching (report/consent dedupe resets). Unsubscribe links in already-sent reminder e-mails stop working (people can still turn reminders off in the app). |
| `DATABASE_URL` | Vercel API, GitHub prod | Supabase pooler URL | Everything until both sides match; rotate the DB password in Supabase, then update both and redeploy. |
| `SUPABASE_JWT_SECRET` | Vercel API, GitHub prod | Legacy HS256 JWT check (JWKS via `SUPABASE_URL` is preferred) | All signed-in requests 401 if the value is wrong. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel API, GitHub prod | Signs storage URLs, deletes objects (server only) | Uploads/playback and the hourly cleanup fail until updated. The key is never returned or logged. |
| `WORKER_SHARED_SECRET` | Vercel API, Fly (worker) | HMAC key for `/internal/*` callbacks | Worker gets 403 until both match. Set it on both sides, redeploy the API, restart the worker; expect a minute of rejected claims (jobs re-queue by lease). |
| `MEDIA_PATH_SECRET` | Vercel API, GitHub prod | Opaque storage folder names `hmac(profile_id)[:16]` | Only new uploads change folder (each asset stores its own path). **Must be identical on API and workflow.** Required when `DJANGO_DEBUG=0`. |
| `IP_HASH_SALT` | Vercel API | Salt for stored IP hashes | Existing hashes no longer match new ones (anonymous report dedupe restarts). |
| `EMAIL_HOST_PASSWORD` (`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`) | Vercel API, GitHub prod | SMTP for expiry reminders and practice reminders (`send_reminders`) | Reminders fail (logged, claim released, retried next run), nothing else. |
| `GEMINI_API_KEY` | Vercel API | Google Gemini key for Generate Twister (blank = the offline `fake` generator) | Generation answers 503 `generator_unavailable` (quota is handed back) until updated. Sent in a request header, never logged or returned. |
| `SENTRY_DSN` | Vercel API | Turns error reporting on (blank = off) | Reporting stops. A DSN is not a strong secret but treat it as one. |
| `VITE_SUPABASE_ANON_KEY` | Vercel web (build time) | Public client key | Sign-in fails until the web is rebuilt with the new key. Public by design; RLS protects data. |
| `VITE_SENTRY_DSN` | Vercel web (build time) | Public ingest DSN | Optional. Unset = Sentry never loads. Wrong DSN = crash reports silently dropped. Rotate by creating a new key in Sentry and rebuilding the web. |
| `VITE_POSTHOG_KEY` | Vercel web (build time) | Public project key | Optional. Unset = analytics never loads. Rotate in PostHog, then rebuild the web. |
| `VITE_POSTHOG_HOST` | Vercel web (build time) | Config, not secret | Optional ingest host (defaults to the US cloud). Must also be allowed in the CSP `connect-src` in `web/vercel.json`. |

## Configuration (not secret; change freely, then redeploy)
| Variable | Set in | Notes |
|---|---|---|
| `DJANGO_DEBUG` | Vercel API | Must be `0` in production |
| `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` | Vercel API | Origins are scheme://host with no path; wrong CORS blocks the web app |
| `DJANGO_SSL_REDIRECT` | Vercel API | Default `0`; Vercel already redirects |
| `DATABASE_SSL_REQUIRE` | Vercel API, GitHub prod | `1` for Supabase |
| `SUPABASE_URL`, `SUPABASE_JWT_AUDIENCE` | Vercel API, GitHub prod | JWKS discovery / audience |
| `VERCEL`, `VERCEL_GIT_COMMIT_SHA` | set by Vercel | Serverless connection handling; Sentry release |
| `MEDIA_STORAGE_BACKEND`, `MEDIA_MAX_BYTES`, `MEDIA_PROCESSING_ENABLED`, `MEDIA_ORPHAN_HOURS` | Vercel API | Processing off until the worker runs |
| `UPLOAD_URL_TTL_S`, `PLAYBACK_URL_TTL_S`, `RESTORE_WINDOW_HOURS`, `CONSENT_REVOCATION_GRACE_HOURS`, `EXPIRY_REMINDER_DAYS`, `VOICE_RETENTION_DAYS`, `ANALYSIS_AUDIO_RETENTION_DAYS` | Vercel API | Media lifecycle |
| `MEDIA_JOB_LEASE_S`, `MEDIA_JOB_MAX_TRIES`, `MEDIA_JOB_MAX_RUN_S`, `MEDIA_WORKER_MAX_HEIGHT`, `MEDIA_WORKER_URL_TTL_S` | Vercel API | Worker queue |
| `SHARE_BASE_URL`, `WEB_BASE_URL`, `API_PUBLIC_URL` | Vercel API, GitHub prod (`WEB_BASE_URL`, `API_PUBLIC_URL`) | Links in e-mails/pages; `API_PUBLIC_URL` builds score-card image URLs (omitted when blank in production) and the one-click `List-Unsubscribe` URL of practice reminders: `send_reminders` refuses to run while either `WEB_BASE_URL` or `API_PUBLIC_URL` is blank |
| `SCORE_CARD_SHARE_DAYS`, `SCORE_CARD_IMAGE_MAX_AGE_S`, `SHARE_MAX_ACTIVE_PER_TARGET`, `REPORT_AUTOHIDE_THRESHOLD`, `CONSENT_VERSIONS` | Vercel API | Sharing and consent rules (`CONSENT_VERSIONS` is JSON) |
| `DEFAULT_FROM_EMAIL`, `EMAIL_BACKEND`, `EMAIL_TIMEOUT`, `EMAIL_USE_TLS`, `WEB_BASE_URL` | Vercel API, GitHub prod (`DEFAULT_FROM_EMAIL`, `WEB_BASE_URL`) | Mail |
| `READ_ALONG_MIN_ACTIVE_MS`, `READ_ALONG_XP_RATIO`, `READ_ALONG_XP_DAILY_CAP`, `SESSION_CLOCK_SKEW_MS` | Vercel API | Practice rules |
| `MASTERY_MIN_SCORE`, `MASTERY_DAYS`, `MASTERY_WINDOW_DAYS`, `MASTERY_ALLOW_PROVISIONAL`, `MASTERY_PROVISIONAL_MIN_CONFIDENCE`, `MASTERY_ALMOST_SCORE` | Vercel API | Mastery |
| `LEADERBOARD_REQUIRE_VERIFIED`, `LEADERBOARD_TOP_N`, `STATS_MAX_POINTS` | Vercel API | Boards and stats |
| `MIN_ENGINE_CONFIDENCE`, `MAX_PLAUSIBLE_WPM`, `SPAM_TRANSCRIPT_LIMIT`, `SPAM_WINDOW_MIN`, `OFFLINE_XP_MAX_AGE_DAYS`, `ATTEMPT_MAX_BACKDATE_DAYS`, `SPOT_CHECK_RATE`, `SPOT_CHECK_MIN_SCORE`, `SPOT_CHECK_MAX_DELTA`, `DEVICE_DISTRUST_AFTER`, `PENDING_RETRY_AFTER_MIN` | Vercel API | Scoring trust and abuse |
| `STREAK_FREEZE_EVERY`, `STREAK_AT_RISK_HOUR`, `NIGHT_OWL_CUTOFF_HOUR` | Vercel API | Streaks |
| `ACCOUNT_DELETION_GRACE_DAYS`, `EXPORT_MAX_ATTEMPTS` | Vercel API | Account deletion/export (spec 15 section 1.2) |
| `GEMINI_MODEL`, `GEMINI_TIMEOUT_S`, `GENERATOR_BACKEND`, `GENERATE_DAILY_LIMIT` | Vercel API | Generate Twister (D24-D26): model (default `gemini-2.5-flash`), provider timeout (10 s, one retry on 5xx/timeout), `gemini` or `fake` (blank = `gemini` when the key is set, otherwise `fake`; the fake returns canned twisters, so set the key before turning the `generate_twister` flag on) and generations per person per UTC day (5) |
| `WORKER_SIGNATURE_MAX_SKEW_S`, `WORKER_ALLOW_LEGACY_SIGNATURE` | Vercel API | Worker signature window (300 s) and legacy acceptance (default `1`; see `deploy-and-rollback.md`) |
| `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE` | Vercel API | Used only when `SENTRY_DSN` is set |
| `SECURE_HSTS_SECONDS`, `SECURE_HSTS_INCLUDE_SUBDOMAINS`, `SECURE_HSTS_PRELOAD`, `SECURE_REFERRER_POLICY`, `API_CSP_REPORT_ONLY` | Vercel API | Response headers (production only for HSTS) |
| `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SITE_URL` | Vercel web (build time) | API origin, Supabase origin, canonical site URL |
| `CODE_EDITOR`, `CODE_INSPECTOR`, `CODE_INSPECTOR_LAUNCH` | developer machines only | Dev click-to-source; never set in production |
| `API_BASE_URL` | Fly (`worker`) | Includes `/api/v1` |
| `WORKER_SHARED_SECRET` | Fly | See above |
| `POLL_INTERVAL_S`, `MAX_JOB_S`, `FFMPEG_THREADS`, `LOG_LEVEL`, `WORKER_ID`, `WORK_DIR`, `HEALTH_FILE`, `MAX_DOWNLOAD_BYTES`, `MAX_UPLOAD_BYTES`, `SHUTDOWN_GRACE_S` | Fly (`fly.toml` `[env]` or secrets) | `fly.toml` sets `POLL_INTERVAL_S=15`, `FFMPEG_THREADS=1`, `LOG_LEVEL=INFO` |
| `DJANGO_SETTINGS_MODULE`, `TEST_DATABASE_URL` | CI / local | Test settings and the Postgres CI job; `TEST_DATABASE_URL` is deliberately not `DATABASE_URL` |

## Rotation procedures
**General:** (1) generate a new random value (`python -c "import secrets;print(secrets.token_urlsafe(48))"`),
(2) set it everywhere in the table's "Set in" column, (3) redeploy API / restart worker, (4) verify, (5) revoke the
old value at its source, (6) note it in the incident file if it was a leak.

**`WORKER_SHARED_SECRET`:** set the new value in Vercel (API) and Fly; redeploy the API, `fly secrets set` restarts
the worker. In between, claims fail with 403 for a minute; the lease sweeper re-queues jobs, nothing is lost.

**`SUPABASE_SERVICE_ROLE_KEY`:** rotate in Supabase (Project Settings → API); update Vercel API and the GitHub
`production` secret; redeploy. Treat as a full-compromise key: after a leak also review storage and auth logs.

**`GEMINI_API_KEY`:** create a new key in Google AI Studio, set it in Vercel (API), redeploy, check a generation
works, then delete the old key. Until then generation fails closed (503) and no quota is spent.

**`MEDIA_PATH_SECRET`:** rotating is safe for existing files (their paths are stored per asset), but it must
change on the API and the workflow together or the workflow computes different folders for new objects.

**`DATABASE_URL`:** change the DB password in Supabase, update Vercel API and GitHub secrets, redeploy.

## Replay of worker callbacks
The HMAC covers `"<timestamp>." + body` and is rejected outside +/- `WORKER_SIGNATURE_MAX_SKEW_S` seconds
(default 300) of the API's clock. **A captured request can be replayed inside that window; this is not
prevented**, because the API is stateless serverless and keeps no nonce cache (spec 15 section 2.1). The
`processed` reports are idempotent (re-reporting a finished asset changes nothing) and a replayed `claim` can only take a job that is then re-queued when its lease lapses, so the exposure is bounded; HTTPS
protects the transport. Rotate `WORKER_SHARED_SECRET` if a signature may have leaked.
