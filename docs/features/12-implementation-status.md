# 12 — Implementation status and what's left

Last audited: **2026-10-01**. This is the one file that says what is shipped and what remains. Update it in the same PR that ships a slice, and delete a line from §2/§3 when it lands.

The PRDs (01–05), per-slice ERDs (06a–06d), the implementation plan (09) and the build specs (13–17) were retired on 2026-10-01 because everything they describe is built. They are still in git history (`git show e39ec68:docs/features/<file>`). What stays: the roadmap (00), master ERD (06), API contract (07), QA catalogue (08), engine design (10), decisions (11), rollout and flags (15) and `runbooks/`.

## 1. Shipped

| Slice | State |
|---|---|
| Baseline (Category, Twister, Profile, Attempt, Favorite, mic scoring, daily twister) | ✅ |
| 06a Hub and Read-along (preferences, sessions, guest sync, flags, error envelope, listen-first, tab lock) | ✅ |
| 06b Speak and Score v2 (scoring v2, TS/Python parity, Train, Word drill, `/practice`, trust ladder, offline queue) | ✅ text layer and trust plumbing. The neural engine is in §2 A |
| 06c Record and media (layouts L1–L7, IndexedDB recovery, cloud save, shares, consent, moderation, worker job API) | ✅ built. Real-device QA and live Supabase verification are in §2 B |
| 06d Progress, social, plans (streaks and freezes, 27 achievements, `/stats`, `/favorites`, Browse facets, weekly board behind a flag) | ✅ built. Not looked at in a browser, see §2 B |
| Round 1: score cards and `/s/:token`, account deletion (30-day grace) and JSON export, night owl mode, worker HMAC timestamps, security headers, CSP report-only, runbooks | ✅ |
| Round 2: Generate Twister (Gemini, private twisters), e-mail reminders with one-click unsubscribe, Sentry and PostHog scaffolding | ✅ API and web. Real Gemini and SMTP calls unverified |
| Round 3: speech-engine groundwork (CTC, forced align, GOP, verdicts, fusion, scoring; Python reference plus TS port with shared vectors), `tools/export_model`, Fly worker deploy runbook | ✅ not wired into any route or flag |
| Round 4: CSP report endpoint, `/s` SEO, reminders card, bundle reductions, Playwright and axe in CI, go-live checklist | ✅ |

Tests at last count: API 1387, web 691, worker 107, export tool 28.

## 2. What is left

### A. Speech engine. Code is complete; what is left needs a Mac, real speakers and a production deploy

Flags `accurate_mode`, `spot_checks` and `record_cloud` stay **off** until the steps below are done in order. Nothing in A is switched on by code.

| # | Item | State |
|---|---|---|
| A1 | Label map and model publish | **Code done** (`label_map.py`, rules, `publish_acoustic_model`, `models` bucket policy, 41 tests). **Left:** run `label_map.py` on the real `vocab.json` (it fails loudly on any unmapped label), export and upload the int8 model, insert the `AcousticModelVersion` row |
| A2 | Device engine | **Code done** (ORT in a module Web Worker, sha-keyed cache, quality gates, device gate, opt-in UI, spot-check upload, TS engine pinned to the Python reference by shared vectors; CSP `wasm-unsafe-eval`). **Left:** real-device timing from `/dev/calibrate` |
| A3 | Calibration | **Code done** (`/dev/calibrate` recorder + benchmark behind flag `calibrate`; `tools/calibrate/{gold,evaluate,fairness,report,tune_thresholds}.py`; 37 tests incl. a frozen synthetic regression). **Left:** record the real gold set (≥ 6 speakers, ≥ 3 en-IN, 12+ twisters each, four scenarios, ≥ 1 non-native), run `tune_thresholds.py` then `report.py --check`, insert the tuned `ScoringProfile` row. The synthetic clips only test the tooling and can never satisfy the gate |
| A4 | Scoring worker | **Code done** (queue, claim/heartbeat/result, lease sweep, worker pipeline, `verified` trust). **Left:** deploy the worker with `SCORING_ENABLED=1` and `MODEL_DIR` on a volume; see `runbooks/accurate-mode-rollout.md` |
| A5 | Record analysis becomes an attempt | **Code done** (doc 13 §14): `record` scoring jobs, server-created `Attempt(kind=record)`, one per recording, never alongside a client-linked attempt, web status line. Off until `RECORD_SCORING_ENABLED=1` |
| A6 | Flip the switches | **Prepared, not flipped.** `*/10 sweep_pending_attempts` cron is enabled in `manage-command.yml` (a no-op until jobs exist); `plan_demand_report` is on the allow-list (`publish_acoustic_model` is not: it needs a manifest, so it is run from a shell, `runbooks/accurate-mode-rollout.md` §0). **Left (in this order, `runbooks/accurate-mode-rollout.md`):** exit gate met → `spot_checks` → `accurate_mode` → `RECORD_SCORING_ENABLED=1` → `LEADERBOARD_REQUIRE_VERIFIED=1`, `MASTERY_ALLOW_PROVISIONAL=0` → `weekly_boards` → `WORKER_ALLOW_LEGACY_SIGNATURE=0` |

CI: a `tools` job runs the `tools/export_model` and `tools/calibrate` tests (no torch, no secrets). `web/e2e/accurate-csp.spec.ts` runs the built inference worker under the production CSP in the existing `web-e2e` job.

### B. Verification (no code). Nothing here has been done against real services

1. **Supabase Pro** (D7). Re-run `storage_policies.sql`, then verify `SupabaseStorage` against the real project: TUS upload with the signed token, `object/info`, range read, batch signing. Only then enable `record_cloud`, then `share_links`.
2. **Real-device Record QA:** Chrome, Edge, Firefox, Safari, phone portrait, Element Capture, long takes, device unplug. Use the matrix in `08-ux-flows-and-edge-cases.md`.
3. **Look at the 06d pages in a browser:** `/`, `/stats`, `/favorites`, `/twisters`, in light and dark, phone width, reduced motion, keyboard only; check confetti, chart tooltips and the sort dropdown focus.
4. **Postgres in production**, with `migrate --plan` empty. CI already runs the API suite on Postgres; production has never run it. `build_leaderboard` has never run in GitHub Actions and has no load test.
5. **SMTP:** send a real reminder through the `Management command` workflow and click the one-click unsubscribe from Gmail. Also confirm the T-3 day expiry e-mail.
6. **Fly worker:** deploy per `runbooks/worker-deploy-fly.md` and run `worker/scripts/smoke.sh remote`. Deploy `MEDIA_PATH_SECRET` to the API **before** this code, or the API will not boot.
7. **One real Gemini call** with `GEMINI_API_KEY` set. Never enable `generate_twister` while the key is blank: that is the canned `fake` backend.
8. **Staged rollout** per `15-rollout-and-flags.md` §3 (allow-list, 10 %, 50 %, 100 %, at least 3 days each). Watch `achievement.evaluation_failed` in the logs.
9. **Owner decisions:** privacy policy and terms, consent-log retention after account deletion, takedown contact address.

### C. Platform and product (code)

| # | Item | State today |
|---|---|---|
| C1 | CSV export | JSON export exists (`GET /me/export/`); no CSV |
| C2 | Cost dashboard (storage, worker minutes, Gemini, scoring jobs) | None |
| C3 | Changelog and in-app "What's new", once per feature | None |
| C4 | First-load JS to 225 KB gz | Home 182.7 KB, Practice Hub 206.4 KB (limits 192 / 217 in `web/bundle-budget.json`) |
| C5 | Login contrast 4.46:1 (needs 4.5:1), logged in `web/e2e/known-a11y.json` | Open |
| C6 | Enforce the CSP (web is `Content-Security-Policy-Report-Only` in `web/vercel.json`, API in `middleware.py`) | After a week of clean reports |

### D. Open questions that need data, not docs. The instruments exist; the data does not
1. **Does the phoneme model meet the accuracy gate on en-IN speakers? What is its size after int8?** `tools/calibrate/report.py` (gold set) and `tools/export_model/benchmark.py` (size, load, latency, memory), plus the benchmark card at `/dev/calibrate` for in-browser numbers per device. The report refuses to call the gate met on insufficient evidence.
2. **Is a paid Pro plan worth building?** `manage.py plan_demand_report` (also in the *Management command* workflow). Cap hits were not recorded anywhere before; `QuotaHit` starts collecting at deploy, so the 60-day clock starts then.

## 3. Files to implement now

Paths are relative to the repo root. **New** = create, **Edit** = change an existing file. Every item also needs tests (listed) and a line removed from §2.

### A1-A6 · Implemented
The file-by-file plan for A1-A6 has been built and tested. The as-built map is the table in doc 13 §9, with §14 (record analysis) and §15 (evidence tools). What is left of A is operational and listed in §2A.

### C1 · CSV export
| | File | What |
|---|---|---|
| Edit | `api/twisters/account/export.py` | A CSV writer with the same whitelist-of-columns rule and the same byte guard (Vercel caps a response at 4.5 MB) |
| Edit | `api/twisters/account/views.py`, `api/twisters/urls.py` | `GET /me/export/?format=csv` (attempts and words as separate files in a zip, or one CSV per `section=`) |
| Edit | `web/src/components/account/DataSection.tsx` | Second download button |
| Test | `api/tests/test_export_csv.py` | Formula injection (`=`, `+`, `-`, `@` prefix), only the caller's rows, truncation flag |

### C2 · Cost dashboard
| | File | What |
|---|---|---|
| New | `api/twisters/media/cost.py` | Aggregates: bytes by plan from `StorageLedger`, `MediaJob` minutes, `ScoringJob` count, Gemini usage from the generation usage table |
| Edit | `api/twisters/admin.py` | A staff-only admin page (no public endpoint) |
| Test | `api/tests/test_cost_dashboard.py` | Staff-only; totals match fixtures |

### C3 · Changelog and "What's new"
| | File | What |
|---|---|---|
| New | `web/src/lib/whatsNew.ts` | Typed list of entries (id, date, title, link) |
| New | `web/src/components/WhatsNew.tsx`, `web/src/routes/changelog.tsx` | Badge and popover, plus a full page; "seen" id in `localStorage` wrapped in try/catch |
| Edit | `web/src/components/Header.tsx` | Mount the badge |
| Test | `web/src/lib/whatsNew.test.ts`, `web/e2e/` smoke | No badge when storage throws; once per entry |

### C4 · Bundle to 225 KB
`web/src/routes/index.tsx` and `web/src/routes/twisters.$slug.tsx` (lazy-load what is not needed to paint), then lower `web/bundle-budget.json`. Never raise a limit to make a build pass. Check with `npm run size` in `web/`.

### C5 · Login contrast
`web/src/routes/login.tsx` (use a token that reaches 4.5:1), then remove the entry from `web/e2e/known-a11y.json` and run `npm run test:a11y`.

### C6 · Enforce the CSP
`web/vercel.json` and `api/twisters/middleware.py` (`API_CSP_REPORT_ONLY`): move from report-only to enforced after reviewing a week of reports (`runbooks/web-ci.md`). Keep the report endpoint.

## 4. Suggested order

1. **Now, no dependencies:** B (verification) in parallel with C4, C5, C1, C3. A1 needs your Mac for the model download.
2. **After A1:** A2 and A4 in parallel (they share only the model and the engine code).
3. **After A2:** A3. The exit gate decides whether Accurate mode ever turns on.
4. **After the exit gate (§2A):** the switches in `runbooks/accurate-mode-rollout.md`, in that order, ending with `weekly_boards`.
5. **Last:** C2, C6, and the staged rollout.

## 5. Reference: deviations, decisions and operations worth remembering

Kept from the earlier status doc so nothing learned during the build is lost. Headings below are the originals.

#### 06c web deviations / assumptions
- Pure-guest and signed-in takes are kept in IndexedDB only (24 h for guests). Cloud UI needs `record_cloud`, a signed-in 13+ account and consent version `v1`.
- Raw layouts (camera only, region) cannot swap a lost device mid-take, so a disconnect ends the take early ("ended early") instead of pausing; composited layouts pause and reconnect.
- The region layout previews nothing (the recorded element is the stage shown above), so there is no self-referencing capture.
- The Speak & score recogniser opens its own microphone stream next to the recorder's; its transcript is not paused while the take is paused.
- `web/package-lock.json` was regenerated by `npm install`; new deps: `tus-js-client`, `idb`, dev `fake-indexeddb`.
- `theme.test.ts`: the code was wrong, not the test. `NIGHT_START_HOUR` was 18 while its doc comments and the tests said the System theme is light 07:00–19:00; the constant is now 19 (the boot script and ThemeMenu hint derive from it).
- A3 web additions (shipped with the addendum): opt-in `public_name` field (`PublicNameField`, validated ≤ 40 like the API) in the share dialog, with an "Anonymous" warning when blank, and on `/recordings`; `analysis` on recording detail (missing = `none`); "Preparing your video…" state with back-off polling (2 s → 15 s, ×1.6, max 60 polls) for `processing` and for analysis `queued|running`, keeping the signed playback URL steady across polls; captions: server VTT when `captions_source='alignment'`, else the local VTT, else any server VTT; "Analyse my take" (`AnalyseControl`: `record_cloud`, 13+, `voice_processing` consent through the shared `ConsentDialog`) with a status chip; "Expiring soon" banner on `/recordings` (download button only: retention is fixed at creation + `retention_days` per D1, so there is no "keep longer"). API shapes assumed: `Profile.public_name`, `RecordingDetail.analysis {status, audio_ready}` and `captions_source`, `POST /recordings/{id}/analyse/` → 202 `{analysis}`, `PATCH /recordings/{id}/ expires_at` accepted up to now + plan `retention_days`.
- There is no profile/settings page yet, so the public name lives where it matters (share dialog and `/recordings`).

#### 06c deviations from the spec / ERD
- Migration split: `0007` schema, `0008` legacy-id tombstones, `0009` FK conversion, `0010` seeds. PostgreSQL cannot ALTER a table after inserting rows that reference it in the same transaction, so data and schema steps are separate.
- `ModerationReport.resolved_by` is the staff **username** (`CharField`), not a Profile FK: moderators are Django admin users, who have no Profile.
- `Recording.layout` is a validated slug (not an enum) so adding a layout stays a web-only change. Extra columns: `Recording.notes`, `hidden_at`, `reminder_sent_at` (migration `0011` renamed it from `expiry_reminded_at`), `audio_asset`; `ShareLink.hidden_at`; `ModerationReport.reporter_ip_hash` (anonymous reporters are deduped by salted IP hash).
- New error codes beyond the contract: `403 feature_disabled`, `403 age_required`, `409 upload_incomplete` (object not there yet — retry), `422 upload_rejected` (`details.reason`: `not_media`, `checksum_mismatch`, `size_out_of_range`, `quota_exceeded`, …).
- Voice clips are gated by the `record_cloud` flag as well (same storage cost/kill switch), plus age 13+ and `voice_storage` consent.
- A `failed` recording does not count toward the recordings limit (it holds no bytes); soft-deleted ones do not either, but keep their bytes charged until the hard delete.
- `expires_at` is stamped at `complete` (creation + `retention_days`), not at create; abandoned uploads are handled by the sweeper.
- `DELETE /recordings/{id}/` and `DELETE /me/consents/{type}/` return `200` with a small body (undo deadline / purge time); `DELETE /shares/{id}/` is `204`.
- Public endpoints answer `403 feature_disabled` when the `share_links` kill switch is off (the flag's allow-list/rollout is deliberately ignored for viewers).
- The upload block carries an extra `standard_url` (single-request upload) next to the TUS `signed_url`/`token`.
- Existing tests touched: `kind="record"` is no longer in the "invalid submissions" list; transactional tests now use `serialized_rollback=True` so seeded plan/flag rows survive them.

#### Known limits / things to verify before enabling `record_cloud`
- `SupabaseStorage` request shapes are covered by fake-transport tests only; run it once against a real Pro project (bucket creation via `storage_policies.sql`, TUS upload with the signed token from `object/upload/sign`, `object/info` for `stat`, range read for sniffing, batch signing).
- Resolved by A2: object folders are now an HMAC of the profile id (`MEDIA_PATH_SECRET`), so signed URLs on public pages no longer contain it. Assets created before `0011` keep their old `{profile_id}/…` path (stored per asset, not backfilled) and stay exposed until they expire; client RLS on storage is deny-all.
- Resolved by A2: `owner.display_name` on public pages now comes only from the opt-in `Profile.public_name` (blank = `null`). The leaderboard endpoints still show `display_name`; review them before making boards public.
- The threaded `reserve` concurrency test only runs on PostgreSQL (CI); sqlite serialises writers.

#### 06d deviations / notes
- Catalogue is 25, not 24 (PRD listed 27 codes; Night-owl pair deferred). `sound_sweep_*` shipped as `sweep_*`.
- Freeze rule follows the ERD (every 7-day streak), not the PRD's "3 consecutive days" (D16). A saved recording does not qualify for a streak day (D17).
- `UserTwisterStats` did not gain `total_active_ms` / `read_along_ms` / `is_favorite` (derivable; one writer per fact).
- No `level` alias on Browse (`difficulty` stays); no `POST /me/timezone/` (`PATCH /me/` does it; the web sets it once per device when the profile is still `UTC`).
- Badge XP is added to `profile.xp`, so it can exceed an attempt's `xp_awarded`; the session PATCH response now also carries `xp_awarded`.
- The weak-word query is shared between `/me/words/weak/` and `/me/stats/`; `drill_targets` no longer issues one query per unplaced word.
- Web: guest favourites stay local and the `/favorites` page fetches each slug; a weak word links to its twister (the `/practice` route only understands `?drill=1`); `DEFAULT_FLAGS` lives in `lib/flags.ts`; a `DailyBars` chart covers `mode=read_along`, where the scored series are empty.
- `weekly_boards` ships **off**. Turn it on only after the scoring worker makes attempts `verified` (`LEADERBOARD_REQUIRE_VERIFIED=1`), otherwise the board is open to unverified device/text-layer scores.

#### Known limits / to verify before enabling 06d for everyone
- Run the suite on PostgreSQL (CI does) — the 06d tests and both migrations were run on sqlite only here.
- Look at `/`, `/stats`, `/favorites`, `/twisters` in light and dark, at phone width, with reduced motion, and with a keyboard; check confetti, chart tooltips and the sort dropdown focus.
- `build_leaderboard` has not run in GitHub Actions and has no load test.
- Achievement failures are swallowed by design (D19): watch logs for `achievement.evaluation_failed`.

### Decisions taken while implementing (docs corrected accordingly)
- `threshold_pct` range is **20–60** (PRD 01 §6, API contract); ERD 06a said 80.
- `loop_count`: **1–10, 0 = loop forever** (PRD says "1–10 or ∞"; ERD comment said "0 = off").
- Guest history is stored in `localStorage` (capped at the API's 50-attempt batch limit), not IndexedDB as D12 says: the data is tiny; revisit if 06b's offline queue needs more.
- Guest sync does not send preferences from the web client: `usePreferences` already merges local settings into the account; the API still accepts them (fresh accounts only).
- Record mode is enabled in the switcher (06c web) behind the `record_local` flag.

#### 06b deviations from the ERD / PRD
- `UserWordStat.recent_error_rate` is an extra column (EMA); `weakness = 0.6·recent + 0.4·lifetime`.
- `TwisterPronunciation` is unique on `(twister, word, accent)`; `twister = NULL` rows are global. Lookups must use `Q(twister=t) | Q(twister__isnull=True)` — `twister__in=[t, None]` silently drops the NULL rows.
- `UserTwisterStats` omits the 06d-only columns (`total_active_ms`, `read_along_ms`, `is_favorite`).
- `LEADERBOARD_REQUIRE_VERIFIED` and `MASTERY_ALLOW_PROVISIONAL` default to permissive until the scoring worker ships; flip both when it does.
- `voice_asset_id` / `audio_asset_id` are plain UUIDs until `MediaAsset` (06c).
- Train chunks are built by the client (3–5 words, punctuation first); server-built chunks stay a 06d idea. "Sounds you swap" stays empty until the accurate engine sends phoneme verdicts.
- Repeated words are *extras* (a stutter is not collapsed) and the "very short twister ×3" rule is not implemented.
- The `accurate_mode` flag ships **off**; `speak_v2` is on (migration 0006). Web `DEFAULT_FLAGS` mirrors that.
- Web tests run in CI (`npm test`); the shared vectors are read straight from `api/tests/fixtures`, so both suites must be changed together.

#### Running management commands (`.github/workflows/manage-command.yml`)
Actions → **Management command** → *Run workflow*: pick a command from the allow-list (`reconcile_speak_stats`, `sweep_pending_attempts`, `build_pronunciations`, `seed_twisters`, `expire_recordings`, `orphan_sweeper`, `sync_achievements`, `build_leaderboard`, `purge_deleted_accounts`, `send_reminders`, `prune_generation_usage`, `plan_demand_report`) and optional arguments (e.g. `--check`). It runs against the production database using the `production` environment's secrets (`DATABASE_URL`, `DJANGO_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_URL`). `reconcile_speak_stats` also runs nightly at 03:17 UTC, `expire_recordings` hourly at :23 (retention, hard delete, consent revocations, T-3 d reminder e-mails) `orphan_sweeper` daily at 04:41 and `build_leaderboard` hourly at :37 (harmless while the `weekly_boards` flag is off) and `send_reminders` hourly at :07 (does nothing while the `reminders` flag is off; needs `API_PUBLIC_URL` and `WEB_BASE_URL` too). Run `sync_achievements` after editing `progress/catalogue.py`. The media jobs also need the `SUPABASE_SERVICE_ROLE_KEY` and `MEDIA_PATH_SECRET` (required by production settings; same value as the API) secrets, plus `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`, `WEB_BASE_URL` for the reminder e-mails, in the `production` environment. To add a command, append it to `ALLOWED` in the "Resolve command" step; to schedule it add a cron entry and a matching `case` line. `sweep_pending_attempts` runs every 10 minutes (enabled; harmless while no scoring jobs exist).

#### 06c A2 deviations / operations notes
- `expiry_reminded_at` was **renamed** (not added alongside) to `reminder_sent_at`; the claim-then-send pattern means a failed delivery releases the flag and the next hourly run retries.
- New API env: `MEDIA_PATH_SECRET` (**required when `DJANGO_DEBUG=0`**; set it in Vercel and in the `production` GitHub environment), `MEDIA_JOB_LEASE_S` (120), `MEDIA_JOB_MAX_TRIES` (3), `MEDIA_JOB_MAX_RUN_S` (900), `MEDIA_WORKER_MAX_HEIGHT` (1080), `MEDIA_WORKER_URL_TTL_S` (1800), `ANALYSIS_AUDIO_RETENTION_DAYS` (7), `EMAIL_*`, `DEFAULT_FROM_EMAIL`, `WEB_BASE_URL`. Deploy `MEDIA_PATH_SECRET` before this code or the API will not start; rotating it only changes the folder of *new* uploads.
- Worker outputs are deterministic per job (`uuid5(job.id, slot)`) and signed with upsert, so a retried upload overwrites and a repeated `processed` call adopts the same rows. The API never accepts a path from the worker (the old `thumbnail_path`/`captions_path` body fields are gone).
- `analyse` also requires `MEDIA_PROCESSING_ENABLED=1`; analysis jobs are not offered to a worker until the recording is `ready` (processing replaces the source file).
- A transcode that would not fit the owner's quota is dropped and the original stays the playback file.
- Worker HMAC has no timestamp/nonce (same scheme as the scoring callback), so a captured request could be replayed over a broken TLS channel; add a signed `ts` if that matters.
- Run `storage_policies.sql` again in the Supabase SQL editor: it drops the old `own upload/read/delete` policies and adds the deny-all one; the `voice` bucket limit is now 100 MiB (analysis WAVs).

#### Speech engine groundwork as built (round 3, retired spec 17)
- Everything is pure functions over a frame-posterior matrix (`T x V` log-probabilities, `vocab[0]` = CTC blank). Python reference: `api/twisters/speak/engine/` (`types`, `phones`, `ctc`, `decode`, `gop`, `verdict`, `assess`, `variants`, `bench`). TypeScript port: `web/src/lib/speak/engine/`. One fixture file, `api/tests/fixtures/engine_vectors.json`, pins both; Python regenerates it in `test_fixture_is_current`, and the TS suite requires identical statuses, reasons, verdicts, spans, score and counts, with floats within 2e-3.
- Quality gate: no frames or no non-blank decode → `no_speech`; blank-argmax share > 0.95 → `nothing_recognised`; fewer than 50 % of words windowed → `could_not_follow`. No score in those cases.
- Pass 1 is a greedy decode, edit-aligned (sub 10, gap 10) to the first variant of each word, giving one window per word; insertion runs of ≥ 3 phones count as `extra`. Pass 2 force-aligns every variant per window and keeps the best by CTC forward probability.
- Verdict per phoneme: `substituted` (delta ≤ -tau_sub), `deleted` (≤ -tau_del), `uncertain` (≤ -tau_uncertain), `weak` (peak_lp < tau_weak), else `ok`. Defaults 3.0 / 3.0 / 1.0 / -0.9 are **placeholders until A3**. Word: a focus phoneme substituted or deleted → `wrong` + `focus_swap`; two or more other errors → `wrong`; one → `near`; weak only → `near` + `slurred`. The text layer can downgrade an uncertain `correct` but can never upgrade an acoustic error. Score v2 arithmetic is unchanged.
- Plugging a real model in (A2/A4): implement `AcousticModel` (ONNX Runtime Web on the device, onnxruntime CPU in the worker), map labels with the generated `label_map.json`, supply a real `Pronouncer` (CMUdict plus overrides through `twisters.speak.lexicon`), then call `assess`. Unknown words block with `UnpronounceableWords`.
- Nothing imports the engine yet (a test on each side enforces that), so Speak mode behaves exactly as before.

### Decisions taken while building A3-A5 and D
* **A record attempt is created server-side only when the recording has none.** The browser's live attempt remains the primary path; the worker covers takes that have no attempt, so no XP is ever awarded twice (`attempt.client_attempt_id = uuid5(recording)` makes the creation idempotent).
* **A record job does not purge its audio** (it belongs to the recording and expires with it); a spot-check clip is purged on settle (D41).
* **Both runtimes score the trimmed read** and report its length as `duration_ms`; the spot-check WAV is exactly the scored bytes (doc 13 §3.7).
* **The synthetic gold set only tests the tooling.** `report.py` counts synthetic clips as no evidence at all, and `tune_thresholds.py` refuses them without `--allow-synthetic`.
* **Cap hits are now recorded** (`QuotaHit`, 10-minute de-duplication per user and limit, 90-day retention) because nothing else could answer the paid-plan question.
* **The `calibrate` flag is seeded off and never re-disabled by a migration** (`get_or_create`), so staff can allow-list themselves without it being reset on deploy.
* **`tools/export_model/make_tiny_model.py`** regenerates the 6.7 KB test model in `web/e2e/fixtures/` (needs `onnx` and `onnxruntime`); the committed files are what CI uses.
