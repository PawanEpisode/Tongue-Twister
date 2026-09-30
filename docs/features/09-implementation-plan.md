# 09 — Implementation Plan, Rollout & Risks

## 1. Guiding constraints
- Solo/small team: ship **vertical slices** behind feature flags; each phase leaves the app better and releasable.
- Keep Vercel (web + Django) for P1–P3. Introduce a **worker service** (Render/Fly/Cloud Run) only in P4 for transcoding.
- Free-tier cost awareness (Supabase storage & egress); no paid speech services.

## 2. Feature flags (server-driven, cached client-side)
`practice_hub` · `read_along` · `speak_v2` · `accurate_mode` · `record_local` · `record_screen` · `record_region` · `record_cloud` · `share_links` · `achievements` · `generate_twister` · `reminders`
Flags evaluated per user (percentage rollout + allow-list). Kill switch on `record_cloud`, `share_links`, `generate_twister`, `accurate_mode`.

## 3. Epics & tickets

### E1 — Practice Hub shell (P1) — *M*
1. Route refactor: `/twisters/$slug` → layout + mode outlet; search params (`mode`, `wpm`, `style`) with validation.
2. Mode switcher (tablist), mobile bottom bar, transitions, teardown contract (`useModeLifecycle`).
3. Settings drawer + `usePreferences` (local + server sync, merge on sign-in). Backend: `UserPreference` model + `GET/PATCH /me/preferences/`.
4. `useMediaPermissions` hook + denied/busy/unavailable UI kit.
5. Side panel (best, attempts, sparkline) with skeleton/error.
6. Tab-lock via `BroadcastChannel`.
7. Keyboard layer + help dialog.
**DoD:** Lighthouse a11y ≥ 95; e2e: mode switching leaves no active tracks; prefs persist across reload/sign-in.

### E2 — Read along (P1) — *M*
1. `buildTimeline(text, wpm, opts)` pure function + unit tests (syllable heuristic, punctuation pauses).
2. `useReadAlongEngine` (rAF scheduler, pause/seek/speed change, visibility handling).
3. Views: Word, Line, Scroll (threshold line, masks).
4. Controls: transport, WPM slider/presets, ladder, loops, countdown, font/mirror/dyslexia.
5. Listen-first TTS (rate mapping, `onboundary` sync with fallback).
6. Completion screen + CTAs; session log (`PracticeSession`).
7. Export headless engine for Record teleprompter.
**DoD:** timing accuracy test (±0.5 % over 3 min on CI fake timers + manual), reduced-motion behaviour, keyboard/touch parity.

### E3 — Speak & Score v2 (P2) — *L*
1. Shared `normalise()` + alignment (`alignWords`) in `packages/shared` (TS) **and** Python port; parity tests with shared JSON vectors.
2. Backend: `AttemptWord`, new Attempt fields, `POST /attempts/` v2, scoring v2 with `score_version`, idempotency, anti-cheat, confidence gate.
3. `UserTwisterStats` + `DailyActivity` updates in the same transaction; mastery logic; backfill migration.
4. Pre-flight component (support/permission/device/level/noise).
5. Mistakes view (5 statuses, tooltips, a11y summary), actions.
6. Train mode: chunking (server suggestion + client fallback), stitching.
7. Word drill screen (TTS, respelling hints, pass criteria).
8. Own-voice local recording + playback (IndexedDB ring buffer of 5).
9. History chart + table; offline queue + `POST /attempts/sync/`.
10. (P2b) In-house engine integration (`10` §11, E3-1…E3-6): lexicon + text compare, synthetic-posterior bench, device engine, calibration, worker spot-checks.
**DoD:** alignment fixtures ≥ 60 cases pass in both languages; no audio persisted when "save voice" off (test); p95 attempt API < 400 ms.

### E4 — Record (local-first) (P3) — *L*
1. Capability detection + support matrix UI.
2. Setup/preview screens, device pickers, level meter.
3. Compositor (canvas) + worker clock; layouts L1, L2, L3, L5, L6.
4. Audio mixer; MediaRecorder wrapper with MIME negotiation and chunk persistence.
5. Countdown, pause/resume, limits, tab-hidden handling, wake lock.
6. IndexedDB store + recovery flow; WebM duration fix.
7. Review page: player, captions from word timings, mistake markers, download.
8. Speech-driven text highlight during recording (reuse E3 engine).
9. Error taxonomy and telemetry.
**DoD:** 200 fake-device e2e runs ≥ 97 % pass; recovery test; memory stays flat over a 3-min run; a11y audit.

### E5 — Record (cloud, screen, sharing) (P4) — *L*
1. Backend: `MediaAsset`, `Recording`, `ShareLink`, `UserConsent`, quotas; signed/resumable upload; `complete` verification; cleanup jobs.
2. Consent + age gating UI.
3. Upload manager (TUS, background retry, progress UI).
4. Worker: FFmpeg transcode → MP4/H.264, thumbnail, loudness, VTT; callback.
5. Screen layouts L4 (bubble drag/resize) and L7 (region capture, Chromium).
6. Share links: create/revoke/expiry/public resolve page `/r/:token`, OG tags, noindex, rate limits.
7. Moderation: report endpoint, admin queue in Django admin, auto-hide threshold.
8. Retention jobs + email reminders for expiring recordings.
**DoD:** pen-test checklist (IDOR, token guessing, signed URL leakage); cost dashboard; takedown SLA documented.

### E6 — Progress & gamification (P2–P5) — *M*
1. `/me/summary`, home strip, mastery states, Browse filters/facets/sort.
2. Streak engine (tz, freezes) + tests; reminders (opt-in).
3. Achievements catalogue + rules engine + toasts + list page.
4. Stats page (charts, weak words) + heatmap.
5. Favourites list + Random.
6. Score card image generation + share short links.
7. Generate Twister (LLM) with safety pipeline + quotas + kill switch.

### E7 — Platform, quality & ops — *ongoing*
- CI: lint, typecheck, unit, API contract tests, Playwright e2e with fake media, visual snapshots, a11y (axe), bundle-size budget.
- Observability: Sentry (web + Django), structured logs, request IDs, dashboards for attempt latency, recording success rate, upload failures, storage growth.
- Security: dependency audit, CSP (allow `blob:` and `mediastream:` for media; `connect-src` Supabase + API), permissions-policy (`microphone=(self), camera=(self), display-capture=(self)`).
- Docs/runbooks: incident playbooks (worker down, model rollout rollback, storage full, abuse wave).

## 4. Sequencing & dependencies

```
E1 ─┬─► E2 ──────────────► (Record teleprompter needs E2 engine)
    ├─► E3 ─┬─► E6.1–6.5
    │       └─► E4.8
    └─► E4 ─► E5
E6.7 (Generate) independent after E1; needs content-safety infra
```
Indicative calendar (1–2 devs): P1 (E1+E2) 3–4 wks · P2 (E3) 4–5 wks · P3 (E4) 4–5 wks · P4 (E5) 5–6 wks · P5 (E6 rest) 3–4 wks. Overlap E6 tasks with P2–P4 as capacity allows.

## 5. Tech choices (proposed)

| Need | Choice | Why |
|---|---|---|
| State | Zustand (or Jotai) for mode/session; TanStack Query for server | Small, avoids prop-drilling across modes |
| Local DB | `idb` (IndexedDB) | Recording chunks, offline queue, voice buffer |
| Charts | Lightweight custom SVG or `visx`/`uPlot` | Bundle size; accessibility control |
| Waveform | `wavesurfer.js` (lazy) or custom canvas from decoded PCM | Voice playback |
| Phonetics | `double-metaphone` (client + `metaphone` python lib server) | Near-match scoring |
| Resumable upload | `tus-js-client` → Supabase resumable endpoint | Reliable large uploads |
| WebM fix | `fix-webm-duration` / `ts-ebml` | Seekable recordings |
| Speech engine | Open-source phoneme CTC model (ONNX) + our own alignment/GOP; device engine in a Web Worker, optional Python worker container | See `10` |
| Worker | FFmpeg on Render/Fly/Cloud Run + DB-backed queue (or managed queue) | Vercel can't run long jobs |
| Feature flags | DB table + cached endpoint (or PostHog) | Simple |
| Analytics | PostHog (EU cloud) with cookie-less mode where possible | Privacy |
| E2E | Playwright with Chromium fake media flags | Deterministic media |

## 6. Telemetry plan (events → dashboards)
Funnels: *Hub view → mode select → start → complete → retry/next*; *Record setup → permission → start → stop → save → share*; *Guest attempt → sign-in → saved*.
Quality: permission denial rate by browser; engine confidence and abstention rates by accent/device; low-confidence rate; recording failure classes; upload retry counts; TTFB of attempt API.
Guardrails: no PII in event props; sampling for high-volume events; user opt-out honoured.

## 7. Rollout
1. Internal dogfood (allow-list) → 2. 10 % → 3. 50 % → 4. 100%, each stage ≥ 3 days with stop-ship criteria: error rate +1 pt, recording failure > 5 %, a11y regression, p95 API > 600 ms.
2. Beta label on Record until success rate ≥ 97 %.
3. Communication: changelog page, in-app "What's new" once per feature.

## 8. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Web Speech inconsistency across browsers | Feature gaps, low trust in scores | Confidence gating; on-device engine (P2b); honest UI |
| Canvas compositing throttled in background tabs | Frozen video | Worker clock, L1 raw path, auto-pause + banner |
| Storage/egress cost blow-up | Budget | Quotas, expiry, 720p default, local-first, lazy transcode |
| Abuse of share links (inappropriate content, minors) | Legal/reputation | Private-by-default, expiry, reports, kill switch, age gates, no public gallery |
| Vercel/serverless limits (timeouts, body size) | Failed uploads | Direct-to-storage uploads; worker service for heavy jobs |
| iOS Safari quirks (recording, speech) | Poor mobile experience | Early device lab testing, capability-based UI, mp4 path |
| Scoring disputes | Churn | Transparent word-level results; `near` credit; versioned scoring; feedback button on results |
| Privacy/regulatory (GDPR, COPPA, BIPA) | Compliance | Consent log, minimisation, deletion/export, no biometrics, age band |
| LLM cost/safety for Generate Twister | Cost, unsafe text | Rate/cost caps, moderation, private-by-default, kill switch |
| Complexity creep in a solo project | Delays | Strict phase gates; P3 can ship as beta; defer P2/P3 items marked P2+ |

## 9. Definition of Done (all tickets)
Code + tests · types/lint clean · a11y checked · skeleton/error/empty states present · analytics events added · docs/OpenAPI updated · feature flag wired · migration reversible · security review for anything touching media/tokens · demo recording attached to PR.

## 10. Immediate next steps (first two weeks)
1. Open questions are resolved in `11-decisions-log.md`; start E3-1 and E3-2 (no model needed) while the model export (E3-3) is arranged.
2. Spike A: timeline accuracy + rAF scheduler (E2.1–2.2) → 1–2 days.
3. Spike B: MediaRecorder + canvas compositing + hidden-tab behaviour across Chrome/Safari/Firefox → 2 days.
4. Spike C: alignment algorithm + fixtures; parity harness TS↔Python → 2 days.
5. Migrations M1 + `UserPreference` API → then build E1.


## 11. Addendum — work items for the in-house engine (replaces the earlier vendor plan)
| Ticket | Epic | Description | Size |
|---|---|---|---|
| E3-1a | E3 | Shared normaliser + lexicon (CMUdict + suffix/compound rules + overrides); `build_pronunciations` command; CI fails if a published word has no pronunciation | M |
| E3-1b | E3 | Phoneme-aware text comparison with focus strictness (homophones correct, focus swap wrong, compound split tolerated); TS + Python with shared test vectors | M |
| E3-2a | E3 | Synthetic-posterior test bench (no model/audio): matrix generator with substitutions, deletions, repeats, reductions | M |
| E3-2b | E3 | CTC forward + Viterbi, two-pass alignment, substitution/deletion tests, verdicts, fusion, scoring (Python reference, then TS port; parity fixtures) | L |
| E3-3 | E3 | Model export/quantise (your machine), label-map generator, size/latency benchmark | M |
| E3-4 | E3 | Device engine (Web Worker, ONNX Runtime Web), model cache/versioning, "Accurate mode" UI, quality gate, device gating | L |
| E3-5 | E3 | `/dev/calibrate` gold-set page, posterior fixtures, threshold tuning, feedback UI, fairness metrics | L |
| E3-6 | E3 | Worker container + queue + spot-check flow + `verified` level; `ScoringJob`, `AcousticModelVersion`, `ScoringProfile` | L |
| E1-a | E1 | `Plan` table + `/me/entitlements/`; `SyncBatch` + `/sync/guest/` | M |
| E5-a | E5 | `StorageLedger` reserve/release, consent gate, Supabase Pro upgrade checklist | M |
| E6-a | E6 | `DailyTwister`, `LeaderboardEntry` job, `NotificationChannel` | M |
Flags: `accurate_mode`, `spot_checks`, `weekly_boards`, `reminders`. Env (worker only): `WORKER_SHARED_SECRET`, `MODEL_STORAGE_URL`. No third-party speech keys exist.
