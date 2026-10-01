# 12 — Implementation Status (PRD/ERD → code)

Last audited: 2026-10-01. Update this table in the same PR that ships a slice.

| Slice (ERD) | PRD | Status | Notes |
|---|---|---|---|
| Baseline (`docs/ERD.md`) | `docs/PRD.md` | ✅ shipped | Category, Twister, Profile, Attempt, Favorite; mic scoring; daily twister |
| **06a Hub & Read-along** | 01, 02 | ✅ shipped (P1) | See breakdown below |
| 06b Speak & Score v2 | 03 | ✅ shipped (text layer + trust plumbing) | See breakdown below. Neural engine, worker container and model export are separate deliverables (doc 10) |
| 06c Record & media | 04 | 🟡 API + web built; needs real camera/screen QA | See breakdown below. Cloud saving and sharing stay behind `record_cloud` / `share_links` (off) until Supabase Pro (D7) |
| 06d Progress, social, plans | 05 | 🟡 core slice built (API + web); Generate Twister, reminders and score-card images not started | Spec `14-06d-build-spec.md`. `Plan` table already existed (06a). Needs browser QA and a Postgres run before users see it |

## 06a breakdown

| Item | State |
|---|---|
| `UserPreference` model + `GET/PATCH /me/preferences/` (range CHECKs, `extra` merge, `If-Unmodified-Since`) | ✅ |
| `PracticeSession` model + `POST /sessions/` (idempotent) + `PATCH /sessions/{id}/` (monotonic, wall-clock bounded) | ✅ |
| `DailyActivity` + shared streak/XP service (`twisters/practice/services.py`), used by attempts **and** Read-along; Read-along XP cap | ✅ |
| `Plan` (+ `free` seed, D1 limits), `Profile.plan/timezone/guest_migrated_at/last_activity_date`, `GET /me/entitlements/` | ✅ |
| Hub route: `?mode=&wpm=&style=` validated deep links, mode switcher (tablist), remembered mode, favourite, "settings not synced" chip | ✅ |
| Read-along: word / line / scroll, WPM + presets, punctuation-aware timeline, countdown, loops, speed ladder, hidden-tab & sleep pause, keyboard layer, reduced motion, mirror/dyslexia/contrast, session logging | ✅ |
| Guest → account preference merge (local `pending` queue) | ✅ |
| `SyncBatch` + `POST /sync/guest/` (idempotent per batch and per `client_attempt_id`; guest attempts re-scored server-side, no XP/streak); web queue in `localStorage` + `GuestSync` on sign-in; guests can star twisters | ✅ |
| `FeatureFlag` + `GET /flags/` (kill switch, allow-list, stable % rollout) + `useFlags` (cached, defaults) gating hub/Read-along | ✅ |
| Error envelope `{"error":{code,message,details,request_id}}` + `X-Request-Id` middleware; web `ApiError` | ✅ |
| Listen-first TTS (boundary-synced, timeline fallback, voice picker, "listen then read"), metronome, focus mode (fullscreen), progress scrubber, long-press "start from here", low-end fallback to word-step, WPM soft warnings | ✅ |
| Automatic default WPM by difficulty (90/110/130/150; `wpm` is nullable = auto) | ✅ |
| Tab lock (`BroadcastChannel`, heartbeat + stale expiry) for Read-along and Speak | ✅ |
| `useMediaPermissions` + `PermissionNotice` (denied/unavailable/in-use, stops re-prompting after 2 denials) wired into Speak | ✅ |
| Side panel (best, attempts, sparkline, focus sounds) via `GET /twisters/{slug}/history/`; next/previous in Browse context (same-level random fallback); share (native sheet / copy link) | ✅ |
| Touch pinch-to-zoom text (also trackpad pinch), metronome volume slider (`metronome_volume`), confirm-before-leaving when > 10 s into a run, sign-in round-trip returns to the twister and restores the typed answer | ✅ |
| Listen first: best-available natural voice per accent (ranked, novelty/robotic voices dropped), calm 0.8–1.0 speech rate | ✅ |
| `POST /attempts/sync/` offline queue for *signed-in* users, idempotent `POST /attempts/` | ✅ 06b |

## 06b breakdown

| Item | State |
|---|---|
| Attempt v2 fields, `AttemptWord`, `AttemptPhoneme`, `TwisterPronunciation`, `UserWordStat`, `UserPhonemeStat`, `UserTwisterStats`, `AcousticModelVersion`, `ScoringProfile`, `ScoringJob`, `AttemptFeedback` (migrations 0005 backfill + 0006 flag) | ✅ |
| Scoring v2 (`twisters/speak/{normalise,similarity,alignment,scoring,pipeline}.py`): forward Needleman–Wunsch, near/homophone/focus-swap, compound merge, cap-79 focus gate | ✅ |
| TypeScript port `web/src/lib/speak/*`, proven equal by shared vectors (`api/tests/fixtures/speak_vectors.json`) and a data-file parity test | ✅ |
| `POST /attempts/` (Idempotency-Key, low-confidence 200, anti-cheat flags), `GET/DELETE /attempts/{id}/`, `POST /attempts/sync/`, word feedback | ✅ |
| `GET /me/words/weak/`, `GET /me/sounds/`, stats rebuildable (`reconcile_speak_stats`) and proven equal to incremental | ✅ |
| Part-twister attempts: `segment` on `POST /attempts/` (Train / Drill score only the practised words; XP scaled by share) and `drill` targets on `GET /me/words/weak/` | ✅ |
| Trust ladder, device results validation, nonce/audio-hash replay guard, spot-check jobs, HMAC worker callback, sweeper, device distrust, `accurate_mode` kill switch, `GET /engine/manifest/` | ✅ (server side) |
| `build_pronunciations [--check]` (overrides → CMUdict → rules; fails on unknown words) | ✅ |
| Web: live highlighting from the shared scorer, word-by-word mistakes view (glyph + label + colour), "what we heard", "I said it right" feedback, low-confidence retry, offline queue (`attemptQueue` + `AttemptSync`), fluency/pause + confidence capture | ✅ |
| **Train** tab (chunks → stitched pairs → whole twister, pass at 85 % of words, listen first / slow, saved as `train`), **Word drill** (model voice, respelling, sentence context, help after 3 misses, saved as `drill`), **/practice** page (weak words with due dates, weak sounds, drill weakest 3 / all / one), "Drill your weak words" from the results screen, expandable recent attempts with the word-by-word view, feedback with an optional note | ✅ |
| Local low-confidence check for guests and offline takes (shared vectors), ASCII-only numeral rules on both sides (fixed API crashes on `❶` and 4 300+ digit runs) | ✅ |
| CI runs the API suite on Postgres as well as sqlite (`TEST_DATABASE_URL`) | ✅ |
| On-device neural engine (Tier 1), scoring worker container, model export | ⬜ doc 10 |
| Audio donation feedback — needs `model_improvement` consent and a non-minor account | ✅ 06c |

## 06c breakdown

Spec: `13-06c-build-spec.md` (§1 = API, §2 = web). Migrations `0007`–`0010`.

| Item | State |
|---|---|
| Models: `Recording`, `MediaAsset`, `StorageLedger`, `ShareLink`, `UserConsent`, `ModerationReport`, `Profile.age_band` — every invariant is a DB constraint (unique client id / `(bucket,path)` / `token_hash` / one active consent per type / one report per reporter; CHECKs for trim order, duration ≤ 600 000, size ≤ 100 MB, enums; partial indexes via `condition=`) | ✅ |
| One `transition()` per model (`StateMachine` mixin) enforcing the ERD 06 §4 state machines | ✅ |
| `Attempt.voice_asset_id` / `ScoringJob.audio_asset_id` are real FKs (`SET_NULL`, same column). `0008` gives every pre-existing id a tombstoned `MediaAsset` first, so nothing is lost and the FK is valid; `0009` renames-then-alters (reversible; tested with data in both directions) | ✅ |
| `0010` flags (`record_local/screen/region` on; `record_cloud`, `share_links` off) and free-plan voice limits | ✅ |
| `twisters/media/` package: `storage` (Supabase over stdlib `urllib` + `InMemoryStorage`, injectable transport), `consent`, `quota` (ledger, per-user `Profile` row lock), `uploads` (shared by recordings and voice), `recordings`, `shares`, `moderation`, `serializers`, `views`, `storage_policies.sql` | ✅ |
| Endpoints: consents (`GET/POST /me/consents/`, `DELETE /me/consents/{type}/`), `PATCH /me/` `age_band`, `GET /me/storage/`, `usage` on `/me/entitlements/`, recordings (create / complete / list / detail / patch / delete / restore / retry-processing / share), voice (`POST /voice/`, `…/complete/`), shares (`GET /shares/`, `DELETE /shares/{id}/`), public (`GET /public/r/{token}/`, `POST …/report/`, `GET /public/s/{token}/`), `POST /attempts/{id}/score-card/`, HMAC worker callback `POST /internal/media/{asset_id}/processed/` | ✅ |
| `kind=record` attempts accepted by `POST /attempts/` (client-side analysis, then linked via `attempt` on create/PATCH) | ✅ |
| Throttles: recordings create 10/h, voice 30/h, share resolve 60/min/IP, share create 30/h, report 10/h/IP | ✅ |
| Jobs: `expire_recordings` (hourly; also sends the expiry e-mails), `orphan_sweeper` (daily; also the media-job lease/retry sweep and removal of originals replaced by a transcode) in the manage-command workflow allow-list and cron | ✅ |
| Django admin: moderation queue (dismiss / action reports), hide/unhide recordings, revoke/hold links; ledger, consent log and assets read-only | ✅ |
| `purge_profile_media(profile)` for account deletion (D14) — service only; `DELETE /me/` does not exist yet | ✅ service |
| Shared helpers extracted: `twisters/security.py` (`require_worker_signature` now used by scoring **and** media callbacks, `client_ip`, `hash_ip`) | ✅ |
| **A2 API additions** (spec 13 Addendum A2; migration `0011`): `MediaJob` queue (idempotent enqueue on `complete`/`retry-processing`, partial unique + CHECK constraints, `SKIP LOCKED` claim on PostgreSQL with a conditional-UPDATE fallback, leases + heartbeats, retries, sweeper), `POST /internal/media/claim/`, `…/jobs/{id}/heartbeat/`, extended `…/{asset_id}/processed/` (derived assets, transcode swap with ledger replacement, `captions_source=alignment`), `POST /recordings/{id}/analyse/` + `analysis` on recording detail, real T-3 d expiry e-mail (`reminders.py`, `Recording.reminder_sent_at`), `Profile.public_name` + `PATCH /me/`, opaque storage folders (`MEDIA_PATH_SECRET`) and deny-all client RLS | ✅ API; real ffmpeg worker, Postgres run and real SMTP unverified here |
| Scoring step that turns the extracted analysis audio into an `Attempt(kind=record)` | ⬜ doc-10 scoring worker; **not built**. The web app keeps creating the attempt client-side and linking it. `analyse` only produces and retains the 16 kHz WAV (`Recording.audio_asset`, 7 days) |
| FFmpeg worker container (`worker/`) | built separately (Addendum A1); talks only to the three worker endpoints above |
| Web (`web/`) | ✅ built, see "06c breakdown (web)" below |

### 06c breakdown (web)

All request/response types live in `web/src/lib/api.ts`; the recorder is a separate lazy chunk (`RecordEntry` → `RecordMode`), and `tus-js-client` loads only when something uploads.

| Item | State |
|---|---|
| API client + types (recordings, uploads, quota, shares, public, consents, `age_band`), `kind=record` attempts, flags `record_local/screen/region/cloud`, `share_links` | ✅ |
| Layout registry L1–L7 (`lib/record/layouts/*`): camera, camera + text, side by side, screen + bubble (drag/resize/keys), PiP, portrait, region (Element/Region Capture, Chromium only, hidden elsewhere) | ✅ unit-tested geometry/text; pixels unverified |
| Capability detection + support matrix, MIME negotiation, quality/bitrate + storage guard (3×), one error taxonomy | ✅ |
| Compositor (worker-driven frame clock so hidden tabs keep ticking), audio mixer + level meter, sources (retry ladder, device watch) | ✅ fakes only |
| Recorder state machine (setup → preview → countdown → recording ⇄ paused → finalizing → review), 60/30/10 s warnings, hidden-tab auto-pause, device-loss and screen-share-stopped handling, wake lock | ✅ |
| IndexedDB chunk persistence (`idb`), crash recovery prompt, 24 h guest retention, WebM duration patch (own EBML) | ✅ fake-indexeddb tests |
| Setup, permissions (`useMediaPermissions` + `PermissionNotice`), preview (level meter, lighting/face hints), countdown, live stage with pause/resume/restart/discard, hotkeys, `aria-live` every 30 s | ✅ |
| Text engines reused: Read-along pacing (`useReadAlong`), Speak & score live matching (`useSpeech`, `liveHits`); word timings feed captions and mistake markers | ✅ |
| Review: mistake markers, next mistake, speed 0.5–2×, captions (VTT download), mirror, frame-step `,` `.`, fullscreen, `ResultCard` + `WordBreakdown`, delivery hints, download, discard | ✅ |
| Cloud save: age-band + consent dialog, upload manager (TUS, persisted jobs, back-off 2/5/15/30/60 s, replay `POST /recordings/` for a fresh grant, `beforeunload` guard), retry chip, quota meter | ✅ against fake TUS; real Supabase unverified |
| Share dialog (expiry limited by plan, link shown once with copy, list + revoke), `/recordings` page (list, thumbnails, storage, delete + undo, player), `/r/$token` public page (noindex, no-referrer, 410/404 pages, report) | ✅ |
| Mode-switch teardown tests (session + hook level: no live tracks, streams, contexts or object URLs) | ✅ |
| Record tab enabled behind `record_local`; hidden after mount in browsers that cannot record; Recordings link behind `record_cloud` | ✅ |
| Telemetry events per PRD 04 §14 (typed; the sink is a no-op until an analytics provider exists) | ✅ |
| Real-device QA (Chrome/Edge/Firefox/Safari, phone portrait, Element Capture, long takes, device unplug) | ⬜ |

### 06c web deviations / assumptions
- Pure-guest and signed-in takes are kept in IndexedDB only (24 h for guests). Cloud UI needs `record_cloud`, a signed-in 13+ account and consent version `v1`.
- Raw layouts (camera only, region) cannot swap a lost device mid-take, so a disconnect ends the take early ("ended early") instead of pausing; composited layouts pause and reconnect.
- The region layout previews nothing (the recorded element is the stage shown above), so there is no self-referencing capture.
- The Speak & score recogniser opens its own microphone stream next to the recorder's; its transcript is not paused while the take is paused.
- `web/package-lock.json` was regenerated by `npm install`; new deps: `tus-js-client`, `idb`, dev `fake-indexeddb`.
- `theme.test.ts`: the code was wrong, not the test. `NIGHT_START_HOUR` was 18 while its doc comments and the tests said the System theme is light 07:00–19:00; the constant is now 19 (the boot script and ThemeMenu hint derive from it).
- A3 web additions (shipped with the addendum): opt-in `public_name` field (`PublicNameField`, validated ≤ 40 like the API) in the share dialog, with an "Anonymous" warning when blank, and on `/recordings`; `analysis` on recording detail (missing = `none`); "Preparing your video…" state with back-off polling (2 s → 15 s, ×1.6, max 60 polls) for `processing` and for analysis `queued|running`, keeping the signed playback URL steady across polls; captions: server VTT when `captions_source='alignment'`, else the local VTT, else any server VTT; "Analyse my take" (`AnalyseControl`: `record_cloud`, 13+, `voice_processing` consent through the shared `ConsentDialog`) with a status chip; "Expiring soon" banner on `/recordings` (download button only: retention is fixed at creation + `retention_days` per D1, so there is no "keep longer"). API shapes assumed: `Profile.public_name`, `RecordingDetail.analysis {status, audio_ready}` and `captions_source`, `POST /recordings/{id}/analyse/` → 202 `{analysis}`, `PATCH /recordings/{id}/ expires_at` accepted up to now + plan `retention_days`.
- There is no profile/settings page yet, so the public name lives where it matters (share dialog and `/recordings`).

### 06c deviations from the spec / ERD
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

### Known limits / things to verify before enabling `record_cloud`
- `SupabaseStorage` request shapes are covered by fake-transport tests only; run it once against a real Pro project (bucket creation via `storage_policies.sql`, TUS upload with the signed token from `object/upload/sign`, `object/info` for `stat`, range read for sniffing, batch signing).
- Resolved by A2: object folders are now an HMAC of the profile id (`MEDIA_PATH_SECRET`), so signed URLs on public pages no longer contain it. Assets created before `0011` keep their old `{profile_id}/…` path (stored per asset, not backfilled) and stay exposed until they expire; client RLS on storage is deny-all.
- Resolved by A2: `owner.display_name` on public pages now comes only from the opt-in `Profile.public_name` (blank = `null`). The leaderboard endpoints still show `display_name`; review them before making boards public.
- The threaded `reserve` concurrency test only runs on PostgreSQL (CI); sqlite serialises writers.

## 06d breakdown (core slice)

Spec: `14-06d-build-spec.md`. Migrations `0012` (schema) and `0013` (seeds: 25 achievements, flags `achievements` on / `weekly_boards` off).

| Item | State |
|---|---|
| Models `Achievement`, `UserAchievement`, `DailyTwister`, `LeaderboardEntry` (+ `built_at`), `Profile.streak_freezes` (CHECK 0..2) and `hide_from_boards`; admin (editorial daily override, revoke action) | ✅ |
| `progress/` package: streaks with freezes (D16), mastery states, levels (`twisters/levels.py`), achievements engine + 25-badge catalogue (13 rule types, state-based, idempotent, savepoint-safe, D19), summary, insights, browse, daily, boards | ✅ |
| Endpoints: `GET /me/summary/`, `GET /me/achievements/`, `POST /me/achievements/seen/`, `GET /me/stats/`, `GET /me/activity/`, `GET /me/favorites/`, `PUT/DELETE /me/favorites/{slug}/`, `GET /twisters/facets/`, `GET /twisters/random/`, `GET /daily/`, `GET /leaderboard/weekly/`; `status` / `sort` / `q` on `GET /twisters/`; `mastery` on every twister | ✅ |
| Hooks: attempt, Read-along session and recording-complete events; `achievements_unlocked` on attempt and session responses; unseen badges via the summary | ✅ |
| Jobs: `sync_achievements`, `build_leaderboard` (workflow allow-list + hourly cron) | ✅ |
| Board privacy (D18): `public_name` or `Player NNNN`, opt-out, under-13 excluded and blocked; also applied to the old per-twister board | ✅ |
| Web: `ProgressStrip` on Home, "Try this twister!" card, `/stats` (KPIs, score/speed charts, activity heatmap, category bars, weak words, achievements) with data-table fallbacks, `/favorites`, Browse status chips + sort menu + facet counts + Random + mastery badges, shared `FavoriteButton`/`useFavorite` (replaces the hub's own toggle), achievement toasts, inline unlocks on the result card, `WeeklyBoard` (flag), one-time browser-timezone sync | ✅ built; **not seen in a browser** |
| Tests | API 504 → 815 pass (+ 2 skipped, sqlite); web 321 → 492 pass; ruff, prettier, eslint and `tsc` clean; `vite build` succeeds |
| G8 score-card **images** and the `/s/:token` landing page (the API for `POST /attempts/{id}/score-card/` and `GET /public/s/{token}/` exists from 06c) | ⬜ next round |
| G9 Generate Twister (`TwisterGeneration`, `POST /twisters/generate/`, safety pipeline, quotas, kill switch) | ⬜ next round |
| G10 reminders (`NotificationChannel`, `PUT /me/notifications/`, one-tap unsubscribe, web-push) | ⬜ next round |
| Night owl mode + `night_owl` / `early_bird` achievements, CSV export, `GET /me/export/`, `DELETE /me/` (D14) | ⬜ |

### 06d deviations / notes
- Catalogue is 25, not 24 (PRD listed 27 codes; Night-owl pair deferred). `sound_sweep_*` shipped as `sweep_*`.
- Freeze rule follows the ERD (every 7-day streak), not the PRD's "3 consecutive days" (D16). A saved recording does not qualify for a streak day (D17).
- `UserTwisterStats` did not gain `total_active_ms` / `read_along_ms` / `is_favorite` (derivable; one writer per fact).
- No `level` alias on Browse (`difficulty` stays); no `POST /me/timezone/` (`PATCH /me/` does it; the web sets it once per device when the profile is still `UTC`).
- Badge XP is added to `profile.xp`, so it can exceed an attempt's `xp_awarded`; the session PATCH response now also carries `xp_awarded`.
- The weak-word query is shared between `/me/words/weak/` and `/me/stats/`; `drill_targets` no longer issues one query per unplaced word.
- Web: guest favourites stay local and the `/favorites` page fetches each slug; a weak word links to its twister (the `/practice` route only understands `?drill=1`); `DEFAULT_FLAGS` lives in `lib/flags.ts`; a `DailyBars` chart covers `mode=read_along`, where the scored series are empty.
- `weekly_boards` ships **off**. Turn it on only after the scoring worker makes attempts `verified` (`LEADERBOARD_REQUIRE_VERIFIED=1`), otherwise the board is open to unverified device/text-layer scores.

### Known limits / to verify before enabling 06d for everyone
- Run the suite on PostgreSQL (CI does) — the 06d tests and both migrations were run on sqlite only here.
- Look at `/`, `/stats`, `/favorites`, `/twisters` in light and dark, at phone width, with reduced motion, and with a keyboard; check confetti, chart tooltips and the sort dropdown focus.
- `build_leaderboard` has not run in GitHub Actions and has no load test.
- Achievement failures are swallowed by design (D19): watch logs for `achievement.evaluation_failed`.

## Decisions taken while implementing (docs corrected accordingly)
- `threshold_pct` range is **20–60** (PRD 01 §6, API contract); ERD 06a said 80.
- `loop_count`: **1–10, 0 = loop forever** (PRD says "1–10 or ∞"; ERD comment said "0 = off").
- Guest history is stored in `localStorage` (capped at the API's 50-attempt batch limit), not IndexedDB as D12 says: the data is tiny; revisit if 06b's offline queue needs more.
- Guest sync does not send preferences from the web client: `usePreferences` already merges local settings into the account; the API still accepts them (fresh accounts only).
- Record mode is enabled in the switcher (06c web) behind the `record_local` flag.

### 06b deviations from the ERD / PRD
- `UserWordStat.recent_error_rate` is an extra column (EMA); `weakness = 0.6·recent + 0.4·lifetime`.
- `TwisterPronunciation` is unique on `(twister, word, accent)`; `twister = NULL` rows are global. Lookups must use `Q(twister=t) | Q(twister__isnull=True)` — `twister__in=[t, None]` silently drops the NULL rows.
- `UserTwisterStats` omits the 06d-only columns (`total_active_ms`, `read_along_ms`, `is_favorite`).
- `LEADERBOARD_REQUIRE_VERIFIED` and `MASTERY_ALLOW_PROVISIONAL` default to permissive until the scoring worker ships; flip both when it does.
- `voice_asset_id` / `audio_asset_id` are plain UUIDs until `MediaAsset` (06c).
- Train chunks are built by the client (3–5 words, punctuation first); server-built chunks stay a 06d idea. "Sounds you swap" stays empty until the accurate engine sends phoneme verdicts.
- Repeated words are *extras* (a stutter is not collapsed) and the "very short twister ×3" rule is not implemented.
- The `accurate_mode` flag ships **off**; `speak_v2` is on (migration 0006). Web `DEFAULT_FLAGS` mirrors that.
- Web tests run in CI (`npm test`); the shared vectors are read straight from `api/tests/fixtures`, so both suites must be changed together.

### Running management commands (`.github/workflows/manage-command.yml`)
Actions → **Management command** → *Run workflow*: pick a command from the allow-list (`reconcile_speak_stats`, `sweep_pending_attempts`, `build_pronunciations`, `seed_twisters`, `expire_recordings`, `orphan_sweeper`, `sync_achievements`, `build_leaderboard`) and optional arguments (e.g. `--check`). It runs against the production database using the `production` environment's secrets (`DATABASE_URL`, `DJANGO_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_URL`). `reconcile_speak_stats` also runs nightly at 03:17 UTC, `expire_recordings` hourly at :23 (retention, hard delete, consent revocations, T-3 d reminder e-mails) `orphan_sweeper` daily at 04:41 and `build_leaderboard` hourly at :37 (harmless while the `weekly_boards` flag is off). Run `sync_achievements` after editing `progress/catalogue.py`. The media jobs also need the `SUPABASE_SERVICE_ROLE_KEY` and `MEDIA_PATH_SECRET` (required by production settings; same value as the API) secrets, plus `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`, `WEB_BASE_URL` for the reminder e-mails, in the `production` environment. To add a command, append it to `ALLOWED` in the "Resolve command" step; to schedule it add a cron entry and a matching `case` line. Enable the `*/10` cron for `sweep_pending_attempts` when the scoring worker ships.

### 06c A2 deviations / operations notes
- `expiry_reminded_at` was **renamed** (not added alongside) to `reminder_sent_at`; the claim-then-send pattern means a failed delivery releases the flag and the next hourly run retries.
- New API env: `MEDIA_PATH_SECRET` (**required when `DJANGO_DEBUG=0`**; set it in Vercel and in the `production` GitHub environment), `MEDIA_JOB_LEASE_S` (120), `MEDIA_JOB_MAX_TRIES` (3), `MEDIA_JOB_MAX_RUN_S` (900), `MEDIA_WORKER_MAX_HEIGHT` (1080), `MEDIA_WORKER_URL_TTL_S` (1800), `ANALYSIS_AUDIO_RETENTION_DAYS` (7), `EMAIL_*`, `DEFAULT_FROM_EMAIL`, `WEB_BASE_URL`. Deploy `MEDIA_PATH_SECRET` before this code or the API will not start; rotating it only changes the folder of *new* uploads.
- Worker outputs are deterministic per job (`uuid5(job.id, slot)`) and signed with upsert, so a retried upload overwrites and a repeated `processed` call adopts the same rows. The API never accepts a path from the worker (the old `thumbnail_path`/`captions_path` body fields are gone).
- `analyse` also requires `MEDIA_PROCESSING_ENABLED=1`; analysis jobs are not offered to a worker until the recording is `ready` (processing replaces the source file).
- A transcode that would not fit the owner's quota is dropped and the original stays the playback file.
- Worker HMAC has no timestamp/nonce (same scheme as the scoring callback), so a captured request could be replayed over a broken TLS channel; add a signed `ts` if that matters.
- Run `storage_policies.sql` again in the Supabase SQL editor: it drops the old `own upload/read/delete` policies and adds the deny-all one; the `voice` bucket limit is now 100 MiB (analysis WAVs).

## Pending from the docs (as of 2026-10-01)

**Next 06d round (PRD 05 G8–G10, ERD 06d M5)**
1. Score-card images (1200×630 and 1080×1080) and the public `/s/:token` page with OG tags (API endpoints already exist from 06c).
2. Generate Twister: `TwisterGeneration`, `POST /twisters/generate/`, `POST /twisters/{slug}/save/`, prompt and output safety pipeline, alliteration quality check, 10/day quota and cost cap, `generate_twister` kill switch, under-13 block, LLM provider choice (not yet made).
3. Reminders: `NotificationChannel`, `PUT /me/notifications/`, one-tap unsubscribe token, email + web-push, `reminders` flag, send window and DND rules.
4. Night owl mode (+ two achievements), CSV export, `GET /me/export/` (JSON export) and `DELETE /me/` (D14; `purge_profile_media` exists as a service only).

**Speech engine (doc 10, E3-3 … E3-6, flag `accurate_mode` off)**
5. Model export/quantise (your machine), on-device engine in a Web Worker (ONNX Runtime Web) with "Accurate mode" UI, `/dev/calibrate` gold-set page and threshold tuning, scoring-worker container with queue, spot-check flow and the `verified` level.
6. Once the worker ships: set `LEADERBOARD_REQUIRE_VERIFIED=1`, turn `MASTERY_ALLOW_PROVISIONAL` off, enable the `*/10` `sweep_pending_attempts` cron, then turn the `weekly_boards` flag on.
7. The scoring step that turns the analysis audio into an `Attempt(kind=record)` (06c leftover).

**Record / cloud (06c leftovers, not code)**
8. Upgrade Supabase to Pro (D7), run `storage_policies.sql` again, verify `SupabaseStorage` (TUS, `object/info`, signed URLs) against the real project, then enable `record_cloud` and `share_links`.
9. Real-device QA for Record (Chrome/Edge/Firefox/Safari, phone portrait, Element Capture, long takes, device unplug); real ffmpeg worker, Postgres and SMTP runs; deploy `MEDIA_PATH_SECRET` before the API.
10. Worker HMAC has no timestamp/nonce (replay over a broken TLS channel) — add a signed `ts` if it matters.

**Platform and ops (doc 09 E7, not started)**
11. Error tracking and observability (Sentry, structured logs dashboards for attempt latency, recording success, upload failures, storage growth); analytics provider (the telemetry sink is a no-op); Playwright e2e with fake media, visual snapshots, axe a11y checks and a bundle-size budget in CI; CSP and `Permissions-Policy` headers; incident runbooks (worker down, model rollback, storage full, abuse wave); cost dashboard and takedown-SLA doc.
12. Rollout mechanics from doc 09 §7 (internal allow-list → 10 % → 50 % → 100 % with stop-ship criteria) and the changelog / "What's new" surface.

**Open questions that need data, not docs (doc 11)**
13. Whether the phoneme model meets accuracy on en-IN speakers; its size after int8 export; whether a paid Pro plan is worth building (after 60 days of cloud-recording cap-hit data).
