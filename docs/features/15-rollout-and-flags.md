# 15 — Rollout and feature flags

Operational companion to `12-implementation-status.md`. Flags are rows of `FeatureFlag`
(`code`, `enabled`, `rollout_pct`, `allow_list`), edited in the Django admin. Every fact below was read from the
code; the "reads it" column names the file.

## 1. How a flag is evaluated (`api/twisters/practice/flags.py`)
1. `enabled = False` is the **kill switch** and beats everything: off for everyone, including the allow-list.
2. Anonymous visitors see a flag only when it is `enabled` **and** `rollout_pct >= 100`.
3. A signed-in user gets it when their profile id is in `allow_list`, or when
   `sha256("<code>:<profile_id>") % 100 < rollout_pct` (stable per user and flag; raising the percentage only adds users).
4. A flag that has no row is off.
5. `GET /api/v1/flags/` returns the evaluated map; it is `private, max-age=60` and the web app refreshes every 60 s
   (`web/src/lib/flags.ts`), so a change takes **up to about 2 minutes** to reach a client. `DEFAULT_FLAGS` in that
   file is only the fallback before the first answer.
6. `switched_on(code)` ignores allow-list/percentage; used for public pages (share links) so a link keeps working for its
   audience whoever was allowed to create it.

`rollout_pct` defaults to 100, so ticking *enabled* on a new row turns it on for everyone. For a staged rollout set
`rollout_pct` (and/or `allow_list`) **before** ticking *enabled*.

## 2. Flag matrix
Seeded state is the migration's; "now" can differ if someone changed it in the admin.

| Flag | Seed | Reads it | What it gates | Turn on when | Prerequisites | When off (kill switch) |
|---|---|---|---|---|---|---|
| `practice_hub` | on (0003) | web `twisters.$slug` | Practice Hub shell and mode picker | always | none | Only the original Speak mode remains on the twister page |
| `read_along` | on (0003) | web `twisters.$slug` | Read-along mode | always | none | Mode hidden |
| `speak_v2` | on (0006) | web `twisters.$slug`, `SpeakAndScore` | Train/score mode and word breakdown | always | none | Train mode and breakdown hidden; attempts API itself is not gated |
| `accurate_mode` | off (0003) | API `speak/serializers.py`, `speak/views.py` (manifest) | On-device acoustic engine | when a model is published and calibrated | An active `AcousticModelVersion` and `ScoringProfile`; none ships yet (`runbooks/model-rollback.md`) | Manifest has no model; `engine=ondevice` attempts get 422 `model_unsupported`; clients use basic scoring |
| `spot_checks` | off (0003) | API `speak/trust.py` | Server re-scoring of device attempts | after `accurate_mode` works and the worker can score | Scoring worker with `SCORING_ENABLED=1` (the `*/10` `sweep_pending_attempts` cron is already enabled in `manage-command.yml`); `runbooks/accurate-mode-rollout.md` | No spot-check jobs are created |
| `calibrate` | off (0021, never reset by a migration) | Web `/dev/calibrate` | Gold-set recorder and in-browser benchmark for staff | allow-list only, never a percentage rollout | none | The route shows "not available"; nothing else changes |
| `record_local` | on (0010) | web `twisters.$slug` | Record mode in the browser | always | none | Record mode hidden |
| `record_screen` | on (0010) | web `lib/flags.ts` defaults only (no reader found) | Screen capture option | n/a | none | no effect today |
| `record_region` | on (0010) | web `lib/flags.ts` defaults only (no reader found) | Region capture option | n/a | none | no effect today |
| `record_cloud` | off (0003) | API `media/uploads.py` `require_cloud`; web `Header`, `recordings` route, `lib/record/cloudGate.ts` | Saving recordings to cloud, `/recordings` page | when storage plan allows (decision D7: Supabase Pro) | Supabase Pro, `MEDIA_STORAGE_BACKEND=supabase`, `SUPABASE_SERVICE_ROLE_KEY`, `MEDIA_PATH_SECRET`; worker if `MEDIA_PROCESSING_ENABLED=1`; adult age band and consent are enforced per user | New cloud recordings answer 403 `feature_disabled`; local recording and existing data unaffected |
| `share_links` | off (0003) | API `media/views.py` (`_require_sharing`); web `cloudGate.ts` | Share links for recordings and the public `/public/r/` page | after `record_cloud` is stable | `record_cloud` on; reports queue staffed (`runbooks/takedown-sla.md`) | Creating and resolving recording links answers 403 `feature_disabled` |
| `score_cards` | on (0015, D20) | web `ScoreCardShare`; API score-card endpoints  | Score-card links and the public `/public/s/` page and image | always (stores no media) | `API_PUBLIC_URL` set so `images` URLs are emitted | Score-card create, JSON and image answer 403 `feature_disabled` |
| `achievements` | on (0013) | API `progress/achievements.py`; web `ProgressStrip`, `AchievementToaster` | Badge evaluation, XP rewards, toasts | always | `sync_achievements` run after catalogue edits | No new unlocks; existing ones stay; UI hidden |
| `weekly_boards` | off (0013) | API `progress/boards.py`; web `routes/index.tsx`; cron `build_leaderboard` | Weekly leaderboard on the daily twister | when enough weekly active players | `build_leaderboard` cron (`37 * * * *`, harmless while off); `hide_from_boards` honoured | Endpoint 403 `feature_disabled`, UI hidden |
| `public_site` | on (0028) | API `twisters/views.py` (teaser), `public/`; web `lib/public/audience.tsx`, `routes/index.tsx`, `routes/twisters.*` | Signed-out landing page, curated teaser and sign-in gate | kill switch only | Cron `refresh_public_stats` (`41 * * * *`); `check_public_site` passes | Signed-out visitors get the old guest-first app and the full catalogue list |
| `landing_demo` | on (0028) | web `components/public/DemoCard.tsx` | Demo card on the landing page | kill switch only | none | Hero shows no demo card; "Try it now" opens the sign-in sheet |
| `newsletter` | off (0028) | web (reserved) | Footer sign-up (not built yet) | when the double opt-in endpoint exists | n/a | n/a |
| `generate_twister` | off (0003) | API `generate/views.py` (`POST /generate/`); web `/generate` and the header/home entry (round 2) | Generate Twister (private, LLM-written) | after `GEMINI_API_KEY` is set and a test generation works; stage by allow-list, watch the Gemini bill and the `generation_rejected` rate | `GEMINI_API_KEY` (blank means the canned `fake` backend: never enable for real users like that), `GEMINI_MODEL`, quota `GENERATE_DAILY_LIMIT` (5/day) and a 3/min throttle are built in; migration `0016` | `POST /generate/` answers 403 `feature_disabled`; people keep and can delete what they already generated (`/me/twisters/`) |
| `reminders` | off (0003) | API `reminders/service.py` (`manage.py send_reminders`, hourly `:07`); `GET/PUT /me/reminders/` and the unsubscribe endpoints work regardless; web reminders card on /account (round 2) | Practice reminder e-mails (opt-in, local hour, one a day) | after a real test mail from the `Management command` workflow (run `send_reminders` by hand with your own address enabled at the current hour), with `EMAIL_*`, `DEFAULT_FROM_EMAIL`, `WEB_BASE_URL`, `API_PUBLIC_URL` set in the `production` environment and the one-click link tested in Gmail; then allow-list, then widen | `EMAIL_*`, `DEFAULT_FROM_EMAIL`, `WEB_BASE_URL`, `API_PUBLIC_URL` (the job refuses to run without the last two), `SECRET_KEY` signs the unsubscribe tokens; migration `0017` | Sending stops at the next run (the flag is checked each run, before any query on preferences); saved preferences and unsubscribes are kept |

Other switches that are **not** flags (environment variables, need a redeploy): `MEDIA_PROCESSING_ENABLED`,
`LEADERBOARD_REQUIRE_VERIFIED`, `MASTERY_ALLOW_PROVISIONAL`, `WORKER_ALLOW_LEGACY_SIGNATURE`; see
`runbooks/secrets-and-rotation.md`.

## 3. Staged rollout procedure 
Applies to any flag whose seed is off. Each stage lasts **at least 3 days** and ends only when no stop-ship
criterion is met.

1. **Allow-list (dogfood).** Create or edit the flag: `rollout_pct = 0`, add your profile ids to `allow_list`
   (profile id = the Supabase user id), then tick *enabled*. Percentage 0 means only the allow-list. Exercise the
   feature on real devices, including a phone and a screen reader.
2. **10 %.** Set `rollout_pct = 10`. Watch the criteria below daily.
3. **50 %.** Set `rollout_pct = 50`.
4. **100 %.** Set `rollout_pct = 100` (also what makes it visible to signed-out visitors).
5. Record each change (flag, value, time) in the incident/release notes. Rolling back is always: untick *enabled*.

**Stop-ship criteria** (any one: stop, drop to the previous stage or kill, write an incident, fix, restart the stage):
- Error rate up by 1 percentage point or more over the pre-stage baseline.
- Recording failure rate above 5 % (the Record beta label stays until success is at least 97 %).
- Any accessibility regression (axe in CI, or a manual finding).
- p95 API latency above 600 ms.
Also stop for: any report of exposed personal data, any storage/cost alarm, or a spike in takedown reports.

Where to look: Vercel (errors, latency, 429s), Sentry when `SENTRY_DSN` is set, admin (Media jobs, Moderation reports),
Supabase usage.

## 4. Pre-launch checklist
Tick each; "how" is the check, not a promise.
**Configuration**
- [ ] `DJANGO_DEBUG=0`, a real `DJANGO_SECRET_KEY`, `MEDIA_PATH_SECRET` set on the API and the GitHub `production`
  environment (the API refuses to boot without them).
- [ ] `DJANGO_ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS` match the live domains; a browser call from
  the web origin succeeds and from another origin has no `Access-Control-Allow-Origin`.
- [ ] `SUPABASE_URL` (+ `SUPABASE_JWT_SECRET` if HS256) set; sign-in works; `DATABASE_SSL_REQUIRE=1`.
- [ ] `SHARE_BASE_URL`, `WEB_BASE_URL`, `API_PUBLIC_URL` point at production.
- [ ] SMTP settings set; a test reminder sent.
**Security**
- [ ] `curl -sI https://<api>/api/health/` shows `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `X-Frame-Options: DENY`; JSON responses show `Content-Security-Policy-Report-Only`.
- [ ] Authenticated JSON answers `Cache-Control: private, no-store`.
- [ ] `WORKER_ALLOW_LEGACY_SIGNATURE=0` once the worker sends timestamps (`runbooks/deploy-and-rollback.md`).
- [ ] The web CSP is still **report-only**; violations reviewed before enforcing (`runbooks/web-ci.md`).
- [ ] Storage RLS deny policy applied (`api/twisters/media/storage_policies.sql`; there is a test).
- [ ] Sentry DSN set on API and web (Round 2 for web); a deliberate test error shows up with no e-mail, token or IP.
**Data and operations**
- [ ] Migrations applied (`manage.py migrate --plan` is empty); `seed_twisters` and `sync_achievements` run.
- [ ] GitHub schedules green for a day: `reconcile_speak_stats`, `expire_recordings`, `orphan_sweeper`,
  `build_leaderboard`, and `purge_deleted_accounts` once it is scheduled.
- [ ] Backups: Supabase PITR/backup confirmed; a restore has been rehearsed once.
- [ ] Worker deployed and a recording reaches `ready` (only if `MEDIA_PROCESSING_ENABLED=1`).
- [ ] An admin account exists; moderation queue opened once; kill switches practised on staging.
- [ ] Runbooks read once end to end (`docs/runbooks/README.md`).
**Legal and product** (owner decisions, not engineering)
- [ ] Privacy policy and terms published; consent texts at the versions in `CONSENT_VERSIONS`.
- [ ] Retention of the consent log after account deletion decided (D21 in `11`).
- [ ] Takedown contact address published; 24 h target understood (`runbooks/takedown-sla.md`).
**Flags at launch**
- [ ] Off until their prerequisites are met: `accurate_mode`, `spot_checks`, `record_cloud`, `share_links`,
  `weekly_boards`, `generate_twister`, `reminders`, `newsletter`. On: `public_site`, `landing_demo`, `practice_hub`, `read_along`, `speak_v2`, `record_local`,
  `achievements`, `score_cards`.
