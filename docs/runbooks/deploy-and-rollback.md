# Deploy and rollback

Two Vercel projects from one repo (`docs/ARCHITECTURE.md`): **web** (root `web`, TanStack Start) and **api**
(root `api`, `api/vercel.json` + `api/index.py`). The worker is a Fly.io app (`worker/`). Migrations are run by
hand against the production `DATABASE_URL`; **no workflow runs `migrate`**. CI (`.github/workflows/ci.yml`) must be
green on the commit first: web lint/check/test, API ruff + `makemigrations --check` + pytest on sqlite and on
Postgres, worker ruff + pytest.

## Before you start
- [ ] CI green on the exact commit. Postgres job included.
- [ ] `MEDIA_PATH_SECRET` is set on the **API Vercel project and the GitHub `production` environment** (the
  API refuses to start with `DJANGO_DEBUG=0` and no `MEDIA_PATH_SECRET`; the management-command workflow needs the
  same value). Set it **before** the first deploy that needs it; see `secrets-and-rotation.md`.
- [ ] New env vars from the release are set in Vercel (API and/or web) and, for the workflow, in the GitHub
  `production` environment secrets.
- [ ] Database backup/point-in-time restore point noted (Supabase dashboard).

## Order of operations (API change with a migration)
1. **Migrate first, additive only.** From a trusted machine with `DATABASE_URL` (pooler or direct) and
   `DJANGO_SECRET_KEY`, `MEDIA_PATH_SECRET`:
   `cd api && python manage.py migrate --plan` (read it), then `python manage.py migrate`.
   Migrations in this repo are written so old code keeps working after the new schema (nullable columns, new
   tables, seeds); a destructive step must be its own later release.
2. **Deploy the API** (merge to the production branch, or Vercel → Deployments → Promote).
3. **Deploy the worker** only if `worker/` changed: `cd worker && fly deploy`.
4. **Deploy the web** project.
5. Run `GET /api/health/`, `GET /api/v1/flags/`, and one real user flow (sign in, one attempt).

## Worker signature cut-over (round 1, D-log in `11`)
The API accepts the old body-only signature while `WORKER_ALLOW_LEGACY_SIGNATURE=1` (the default), so either
side can deploy first.
1. Deploy the API with the timestamp verifier (legacy still on).
2. Deploy the worker (`fly deploy` in `worker/`); it now sends `X-Worker-Timestamp`.
3. Confirm a job completes (admin → Media jobs → `done`) and `fly logs` has no `HTTP 403`.
4. Set `WORKER_ALLOW_LEGACY_SIGNATURE=0` on the API Vercel project and redeploy the API (env changes need a new
   deployment). Confirm a job again.
5. Rollback of this step is setting it back to `1`. Never roll the **worker** back to an image older than the
   timestamp change while the flag is `0`; every call would be rejected with 403 (`worker-down.md`).

## Rolling back
**Code only (no migration in the release):** Vercel → project → Deployments → pick the previous production
deployment → *Promote to Production* (or *Instant Rollback*). Worker: `fly releases -a worker-moonlit-waterfall-8666`
then `fly deploy --image <previous image>` (or redeploy the previous commit).

**A release with a migration:** roll the *code* back first (the older code runs on the newer additive schema).
Reverse the migration only if it is itself the problem:
1. `python manage.py showmigrations twisters` and note the last good name.
2. `python manage.py migrate twisters <last_good_name>` runs each migration's reverse. Schema reverses **drop
   the columns/tables they added, with their data** (for example the Round 1 account columns); data-seed reverses
   remove exactly what they seeded. Take a backup first. Migrations here are tested reversible with data present.
3. Redeploy the API commit that matches the schema.
4. A reverse that was never run in anger is a risk; rehearse on a Postgres copy for anything with a backfill.

**Feature misbehaving but not crashing:** use the flag kill switch instead of a rollback
(`../features/15-rollout-and-flags.md`).

## Verify
`/api/health/` ok; flags endpoint answers; a worker job completes; Sentry (if `SENTRY_DSN` is set) shows no new
error class; the response headers still include `Strict-Transport-Security` and `X-Content-Type-Options` (spec
15 section 2.3) via `curl -sI https://<api>/api/health/`.

## Follow-up
Write down what shipped and the migration names in `docs/features/12-implementation-status.md`.
