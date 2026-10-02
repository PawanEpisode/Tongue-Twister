# Runbooks

Written for one operator at 2 a.m. Each follows **symptom → check → fix → verify → follow-up**. Facts here
come from the code; if a name does not match, the code wins and the runbook is the bug.

| Runbook | Use when |
|---|---|
| [worker-deploy-fly.md](worker-deploy-fly.md) | Deploying, scaling, smoke-testing or rolling back the media worker on Fly.io (first deploy included) |
| [worker-down.md](worker-down.md) | Recordings stay "processing"; the media worker is not claiming jobs |
| [accurate-mode-rollout.md](accurate-mode-rollout.md) | Publishing the model, proving the exit gate, then turning on spot-checks, Accurate mode and record scoring, in order |
| [model-rollback.md](model-rollback.md) | A scoring/acoustic model misbehaves, or before shipping one |
| [storage-full.md](storage-full.md) | Uploads fail, the bucket or database is near its quota |
| [abuse-wave.md](abuse-wave.md) | Reports spike, spam attempts, scraping, abusive share links |
| [takedown-sla.md](takedown-sla.md) | Someone asks for content to be removed (24 h target) |
| [deploy-and-rollback.md](deploy-and-rollback.md) | Shipping or undoing a release, migrations, worker signature cut-over |
| [secrets-and-rotation.md](secrets-and-rotation.md) | Rotating a key, or finding where a variable is set |
| [incident-template.md](incident-template.md) | Copy at the start of any incident |
| [web-ci.md](web-ci.md) | Web CI, bundle budget, CSP violations (owned by the web-infra agent; may not exist yet) |

Where things live: API and web on **Vercel** (two projects, `docs/ARCHITECTURE.md`), the media worker on
**Fly.io** (`worker/fly.toml`), database, auth and storage on **Supabase**, scheduled jobs on **GitHub
Actions** (`.github/workflows/manage-command.yml`, environment `production`). Health probe:
`GET /api/health/` on the API returns `{"status":"ok"}` (it does not touch the database).
Flags are rows in the `FeatureFlag` table, edited in the Django admin (`/admin/`); see
[../features/15-rollout-and-flags.md](../features/15-rollout-and-flags.md).

## Go-live checklist

Do these in order; stop at the first failure and use the linked runbook.

1. **Migrate.** Back up, then run `migrate` against production Postgres via the `manage-command` workflow; migrations apply before the new API code serves traffic ([deploy-and-rollback.md](deploy-and-rollback.md)).
2. **Seeds.** Run `seed_twisters` (and any other seed commands) from the same workflow, then create the feature flag rows; confirm twisters list and flags exist in `/admin/`.
3. **Secrets.** Set every variable before deploying, API first for `MEDIA_PATH_SECRET`: Django `SECRET_KEY`, database URL, Supabase URL and keys, worker HMAC secret, SMTP credentials, `GEMINI_API_KEY`, `VITE_SENTRY_DSN` / `VITE_POSTHOG_KEY` (web). Where each lives and how to rotate: [secrets-and-rotation.md](secrets-and-rotation.md).
4. **Flags.** Leave `record_cloud`, `share_links`, `accurate_mode` and `weekly_boards` off. Enable `generate_twister` and `reminders` only after steps 6 and 7; roll out gradually ([../features/15-rollout-and-flags.md](../features/15-rollout-and-flags.md)).
5. **Worker deploy.** Deploy the media worker to Fly and run its smoke test ([worker-deploy-fly.md](worker-deploy-fly.md)); recovery in [worker-down.md](worker-down.md).
6. **Smoke.** `GET /api/health/` returns `ok`; sign in, practise a twister, open a score card `/s/<token>`, generate a twister, send yourself a reminder and click unsubscribe. Web side: CSP and CI notes in [web-ci.md](web-ci.md).
7. **Monitoring.** Confirm Sentry receives a test error and PostHog an event; watch the CSP console for a week before enforcing; know the incident runbooks ([incident-template.md](incident-template.md), [storage-full.md](storage-full.md), [abuse-wave.md](abuse-wave.md), [takedown-sla.md](takedown-sla.md)).
