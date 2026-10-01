# 16 — Round 2 build spec: Generate Twister (Gemini), email reminders, observability

Binding for agents. House style: specs 13/14/15. Decisions continue the log (D24+).

## 0. Decisions
- D24 LLM provider: Google Gemini via REST (stdlib `urllib`, injectable transport; NO new SDK). Config: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-2.5-flash`, configurable), `GENERATOR_BACKEND` = `gemini` | `fake` (default `fake` when no key). Structured JSON output (`responseMimeType: application/json` + schema). 10 s timeout, 1 retry on 5xx/timeout, never log prompts' user text beyond length.
- D25 Generated twisters are PRIVATE to the owner (`visibility=private`, `owner=profile`), never appear in lists/daily/random/facets/categories/summary/leaderboard/sitemap/drill targets of others. Implement via `Twister.objects.visible_to(profile)` and use it on every listing path. Owner can practise, delete and (later) publish nothing.
- D26 Safety: prompt-injection-resistant (user topic is data, length ≤120, strip control chars), output validated (length 20–240 chars, ≥ 8 words, language check basic, blocklist reuse of existing profanity/abuse filter if present), reject otherwise with `generation_rejected`. Quota: 5 generations/day/user (setting `GENERATE_DAILY_LIMIT`), 3/min throttle. Flag `generate_twister` (already seeded off) gates it.
- D27 Reminders: email only. `ReminderPreference(profile, enabled, hour_local, last_sent_on)`; `send_reminders` management command hourly (`:07`) added to workflow allow-list + cron; sends to users whose local hour == hour_local, who have not practised that local day, enabled, not pending-deletion, with a verified email. Uses existing EMAIL_* settings (console backend in dev). RFC 8058 one-click unsubscribe: signed token (django signing) `List-Unsubscribe` + `List-Unsubscribe-Post`, public endpoint `POST/GET /public/unsubscribe/{token}/` idempotent. Flag `reminders` gates sending. Max 1 mail/day/user.
- D28 Observability: Sentry (web `@sentry/react` lazy-loaded, only when `VITE_SENTRY_DSN` set; PII scrubbed; API side already scaffolded in `twisters/observability.py`), PostHog (`posthog-js` lazy, only when `VITE_POSTHOG_KEY` set; cookieless (`persistence: 'memory'`), no autocapture, no session replay, respects Do-Not-Track and an in-app opt-out toggle on /account stored in localStorage). Event allow-list in one file; no PII/transcripts/emails ever in events.

## 1. Agents & ownership (sequential on API for migrations)
1. api-gen: `api/twisters/generate/*` (service, gemini client, fake generator, validators, views, serializers), `Twister` owner/visibility fields + migration `0016`, `visible_to` plumbing in all listing paths, tests, docs 07 §17, flag stays off by default (document enabling).
2. web-gen (parallel to api-gen; own copy `~/tw/web-gen`): `/generate` route, `/my-twisters` route, `lib/generate/*`, header/home entry gated by `useFlag('generate_twister')`, tests.
3. api-rem (after api-gen): `api/twisters/reminders/*`, migration `0017`, `send_reminders` command, unsubscribe endpoints, email templates (text+html), workflow allow-list/cron edits, tests, docs 07 §18.
4. web-rem+obs (after web-gen; own copy `~/tw/web-obs`): reminders card as an ACCOUNT_SECTIONS entry (do not edit other sections), `/unsubscribe/$token` page, `lib/observability/{sentry,analytics,consent}.ts`, privacy opt-out section, CSP `connect-src` additions in `vercel.json` (PostHog host + Sentry ingest, env-driven note), `.env.example`, tests.

## 2. API contract
- `POST /generate/` `{topic: str(≤120), difficulty?: 1-5, language?: 'en'}` → 201 Twister (private) ; errors: 429 `generation_limit`, 422 `generation_rejected`, 503 `generator_unavailable`, 403 flag off (404-style per house flag semantics).
- `GET /me/twisters/` own generated list; `DELETE /me/twisters/{id}/`.
- `GET/PUT /me/reminders/` `{enabled, hour_local(0-23)}`.
- `GET|POST /public/unsubscribe/{token}/` → 200 `{unsubscribed:true}`.
Follow existing error envelope and pagination conventions.

## 3. Quality gates
API: full pytest, ruff check/format, makemigrations --check (DJANGO_SETTINGS_MODULE=config.settings_test; never touch the prod DATABASE_URL in api/.env). Web: tsc, eslint, prettier, vitest, vite build; rsync only owned files back to the repo web/. Tests must cover: leak-proofing of private twisters on every path, quota, injection strings, fake transport failures, unsubscribe idempotency, DST-safe local-hour selection, observability disabled without keys (no network, no import).
Secrets are never committed; document each in `.env.example`.
