# Runbooks

Written for one operator at 2 a.m. Each follows **symptom → check → fix → verify → follow-up**. Facts here
come from the code; if a name does not match, the code wins and the runbook is the bug.

| Runbook | Use when |
|---|---|
| [worker-deploy-fly.md](worker-deploy-fly.md) | Deploying, scaling, smoke-testing or rolling back the media worker on Fly.io (first deploy included) |
| [worker-down.md](worker-down.md) | Recordings stay "processing"; the media worker is not claiming jobs |
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
