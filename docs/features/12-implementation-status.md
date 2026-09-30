# 12 — Implementation Status (PRD/ERD → code)

Last audited: 2026-09-30. Update this table in the same PR that ships a slice.

| Slice (ERD) | PRD | Status | Notes |
|---|---|---|---|
| Baseline (`docs/ERD.md`) | `docs/PRD.md` | ✅ shipped | Category, Twister, Profile, Attempt, Favorite; mic scoring; daily twister |
| **06a Hub & Read-along** | 01, 02 | ✅ shipped (P1) | See breakdown below |
| 06b Speak & Score v2 | 03 | ✅ shipped (text layer + trust plumbing) | See breakdown below. Neural engine, worker container and model export are separate deliverables (doc 10) |
| 06c Record & media | 04 | ⬜ not started | P3/P4 |
| 06d Progress, social, plans | 05 | ⬜ not started | `Plan` table already exists (from 06a) |

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
| Trust ladder, device results validation, nonce/audio-hash replay guard, spot-check jobs, HMAC worker callback, sweeper, device distrust, `accurate_mode` kill switch, `GET /engine/manifest/` | ✅ (server side) |
| `build_pronunciations [--check]` (overrides → CMUdict → rules; fails on unknown words) | ✅ |
| Web: live highlighting from the shared scorer, word-by-word mistakes view (glyph + label + colour), "what we heard", "I said it right" feedback, low-confidence retry, offline queue (`attemptQueue` + `AttemptSync`), fluency/pause + confidence capture | ✅ |
| On-device neural engine (Tier 1), scoring worker container, model export | ⬜ doc 10 |
| Train / Word-drill UI, weak-word and weak-sound screens (endpoints ready) | ⬜ 06d |
| Audio donation feedback (needs `UserConsent`, 06c) — returns `403 consent_required` | ⬜ 06c |

## Decisions taken while implementing (docs corrected accordingly)
- `threshold_pct` range is **20–60** (PRD 01 §6, API contract); ERD 06a said 80.
- `loop_count`: **1–10, 0 = loop forever** (PRD says "1–10 or ∞"; ERD comment said "0 = off").
- Guest history is stored in `localStorage` (capped at the API's 50-attempt batch limit), not IndexedDB as D12 says: the data is tiny; revisit if 06b's offline queue needs more.
- Guest sync does not send preferences from the web client: `usePreferences` already merges local settings into the account; the API still accepts them (fresh accounts only).
- Record mode is shown in the switcher as disabled ("Soon") until P3.

### 06b deviations from the ERD / PRD
- `UserWordStat.recent_error_rate` is an extra column (EMA); `weakness = 0.6·recent + 0.4·lifetime`.
- `TwisterPronunciation` is unique on `(twister, word, accent)`; `twister = NULL` rows are global. Lookups must use `Q(twister=t) | Q(twister__isnull=True)` — `twister__in=[t, None]` silently drops the NULL rows.
- `UserTwisterStats` omits the 06d-only columns (`total_active_ms`, `read_along_ms`, `is_favorite`).
- `LEADERBOARD_REQUIRE_VERIFIED` and `MASTERY_ALLOW_PROVISIONAL` default to permissive until the scoring worker ships; flip both when it does.
- `voice_asset_id` / `audio_asset_id` are plain UUIDs until `MediaAsset` (06c).
- Repeated words are *extras* (a stutter is not collapsed) and the "very short twister ×3" rule is not implemented.
- The `accurate_mode` flag ships **off**; `speak_v2` is on (migration 0006). Web `DEFAULT_FLAGS` mirrors that.
- Web tests run in CI (`npm test`); the shared vectors are read straight from `api/tests/fixtures`, so both suites must be changed together.
