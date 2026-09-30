# 12 — Implementation Status (PRD/ERD → code)

Last audited: 2026-09-30. Update this table in the same PR that ships a slice.

| Slice (ERD) | PRD | Status | Notes |
|---|---|---|---|
| Baseline (`docs/ERD.md`) | `docs/PRD.md` | ✅ shipped | Category, Twister, Profile, Attempt, Favorite; mic scoring; daily twister |
| **06a Hub & Read-along** | 01, 02 | ✅ shipped (P1) | See breakdown below |
| 06b Speak & Score v2 | 03 | ⬜ not started | Next: `AttemptWord`, `UserTwisterStats`, Attempt v2 fields, `POST /attempts/sync/` |
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
| Touch pinch-to-zoom text, metronome volume slider, confirm-before-leaving when > 10 s into a run, sign-in mid-session snapshot restore (transcript) | ⬜ minor / deferred |
| `POST /attempts/sync/` offline queue for *signed-in* users, idempotent `POST /attempts/` | ⬜ 06b |

## Decisions taken while implementing (docs corrected accordingly)
- `threshold_pct` range is **20–60** (PRD 01 §6, API contract); ERD 06a said 80.
- `loop_count`: **1–10, 0 = loop forever** (PRD says "1–10 or ∞"; ERD comment said "0 = off").
- Guest history is stored in `localStorage` (capped at the API's 50-attempt batch limit), not IndexedDB as D12 says: the data is tiny; revisit if 06b's offline queue needs more.
- Guest sync does not send preferences from the web client: `usePreferences` already merges local settings into the account; the API still accepts them (fresh accounts only).
- Record mode is shown in the switcher as disabled ("Soon") until P3.
