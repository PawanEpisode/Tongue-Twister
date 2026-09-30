# API Contract 07 — Practice Suite

Base URL: `/api/v1` · Format: JSON (`application/json`) · Auth: `Authorization: Bearer <Supabase JWT>` (optional for public reads) · Times: ISO-8601 UTC · IDs: UUID or bigint as noted.
All new endpoints are documented in OpenAPI (`/api/docs/`) via drf-spectacular; this file is the human-readable contract.

## 1. Conventions

| Topic | Rule |
|---|---|
| Errors | `{"error":{"code":"quota_exceeded","message":"…","details":{…},"request_id":"…"}}` with correct HTTP status |
| Common codes | `400 validation_error` · `401 unauthenticated` · `403 forbidden` · `404 not_found` · `409 conflict` · `410 gone` · `413 too_large` · `415 unsupported_media_type` · `422 unprocessable` · `429 rate_limited` · `402 quota_exceeded` · `503 dependency_unavailable` |
| Idempotency | `Idempotency-Key` header (UUID) on all POSTs that create; `client_attempt_id` / `client_session_id` in body for attempts/sessions. Replays return **the original response** with `Idempotent-Replay: true` |
| Pagination | `?page=&page_size=` (default 24, max 100) → `{count,next,previous,results}` |
| Sparse fields | `?fields=slug,text` where useful (Browse) |
| Rate limits | anon 120/min · user 300/min · attempts 30/10 min · recordings create 10/h · generate 10/day · share resolve 60/min/IP. `429` includes `Retry-After` |
| Caching | Public twister lists: `Cache-Control: public, max-age=60, stale-while-revalidate=300`; user data: `private, no-store` |
| Versioning | Additive changes only within `/v1`; breaking → `/v2` |
| Guests | Endpoints marked 🔓 work unauthenticated; the client scores locally and syncs after sign-in |

### 1.1 Shipped in 06a
`GET /flags/` 🔓 → `{"flags":{"read_along":true,…}}` (evaluated for the caller; cache 60 s; `enabled=false` is a kill switch, then allow-list, then stable percentage rollout). `POST /sync/guest/` 🔐 `{client_batch_id, kind?, preferences?, favorites[≤200], attempts[≤50]}` → `201 {attempts_imported, favorites_imported, rejected}`; a repeated batch id returns `200` + `Idempotent-Replay: true` with the same counts; invalid rows are counted in `rejected`, not fatal; imported attempts are re-scored and earn no XP/streak. `GET /twisters/{slug}/history/?range=10|30|all` 🔐 → `{count, best_score, results[]}`. Every error uses the envelope above and every response carries `X-Request-Id`.

## 2. Preferences

### `GET /me/preferences/` 🔐 → `200`
```json
{ "default_mode":"speak_score","accent_lang":"en-GB","display_style":"word","wpm":null,"threshold_pct":35,
  "font_scale":1.0,"mirror_text":false,"loop_count":1,"punctuation_pauses":true,"metronome":false,
  "save_voice_default":false,"record_layout":"camera_text","record_resolution":"720p","countdown_s":3,
  "reduce_motion":false,"dyslexia_font":false,"high_contrast":false,"extra":{},"updated_at":"2026-09-29T10:00:00Z" }
```
`wpm: null` means automatic (by twister difficulty: 90/110/130/150).
### `PATCH /me/preferences/` 🔐 — partial update, validates ranges (wpm 40–300, threshold 20–60, font 0.8–2.0, loop_count 0–10 where 0 = forever). `extra` is merged key-by-key; everything else is last-write-wins. `If-Unmodified-Since` optional for optimistic concurrency → `409` on stale.

## 3. Twisters (extensions)

| Endpoint | Purpose |
|---|---|
| `GET /twisters/?level=&category=&origin=&min_words=&max_words=&q=&sort=&status=mastered\|in_progress\|not_started\|favorites` 🔓 | Browse with facets |
| `GET /twisters/facets/` 🔓 | `{"levels":{"1":16,"2":74,"3":85,"4":30},"categories":{"hissers":45,…},"origins":{…}}` |
| `GET /twisters/{slug}/` 🔓 | + `pronunciations[]`, `chunks[]` (server-suggested Train chunks: `[{"i":0,"text":"Peter Piper picked"}]`), `estimated_ms_at_wpm` hint |
| `GET /twisters/random/?level=&category=&exclude=slug1,slug2` 🔓 | Weighted for signed-in users |
| `GET /twisters/{slug}/history/?range=10\|30\|all` 🔐 | Attempts for the chart/table |
| `GET /twisters/{slug}/leaderboard/` 🔓 | Top 10 (verified Test attempts only) |
| `POST /twisters/{slug}/favorite/` 🔐 | Toggle (idempotent variants: `PUT`/`DELETE /favorites/{slug}/`) |

## 4. Practice sessions

### `POST /sessions/` 🔐 (optional; guests skip) → `201`
```json
{ "client_session_id":"a3f…", "twister":"fuzzy-wuzzy", "mode":"speak_score", "submode":"test",
  "settings_snapshot":{"wpm":110,"lang":"en-GB"}, "engine":"webspeech", "user_agent_family":"chrome-131" }
```
### `PATCH /sessions/{id}/` — `{ "status":"completed", "active_ms":48210, "loops_completed":3 }`

`PATCH` accepts `status` (`completed`|`abandoned`), `ended_reason`, `active_ms`, `loops_completed`, `passes_completed`, `avg_wpm`. `active_ms` is monotonic and capped at wall-clock time since start. The response adds `xp_awarded` and `profile`. Once a session is `completed`/`abandoned` it is immutable: repeat PATCHes return the stored state with `xp_awarded: 0` (safe retries). A Read-along session earns streak + XP only with ≥ 1 pass **and** ≥ 30 s active (`READ_ALONG_MIN_ACTIVE_MS`); XP = 25 % of a scored attempt, capped 50/day.

Sessions are advisory analytics/records; **attempts remain valid without a session** (guests, offline).

## 5. Attempts v2

### `POST /attempts/` 🔐 → `201` (or `200` on idempotent replay)
Request:
```json
{
  "client_attempt_id":"5e3c2b0e-…",
  "twister":"peter-piper",
  "session_id":"…",
  "kind":"test",
  "transcript":"peter piper picked up pickle peppers",
  "duration_ms":4900,
  "long_pause_ms":350,
  "stt":{"engine":"text_layer","lang":"en-GB","confidence":0.82,"words":[{"w":"peter","conf":0.9,"start_ms":120,"end_ms":420}]},
  "voice_asset_id":null,
  "client_score":{"version":2,"score":61}
}
```
Response:
```json
{
  "id":1042,"score":61,"score_version":2,"accuracy":0.58,"speed_score":0.9,"fluency_score":0.96,"wpm":128.4,
  "personal_best":true,"level_up":false,"xp_awarded":18,"mastered_now":false,
  "words":[
    {"target_index":0,"target":"Peter","spoken":"peter","status":"correct","credit":1.0},
    {"target_index":3,"target":"a","spoken":"up","status":"wrong","credit":0.0},
    {"target_index":null,"spoken":"pickle","status":"extra","credit":-0.15}
  ],
  "profile":{"xp":420,"level":3,"current_streak":4,"best_streak":6},
  "achievements_unlocked":[{"code":"first_test","name":"Put to the Test"}],
  "low_confidence":false
}
```
Rules: server recomputes score from `transcript` (client score only for diagnostics/drift metrics). `transcript` ≤ 4 000 chars, `duration_ms` 300–300 000. If `stt.confidence < 0.45` → `200` with `low_confidence:true`, **not persisted**, `score:null`. Duplicate `client_attempt_id` → original body. Implausible WPM (> 320) → persisted with `flagged:true`, excluded from boards, response includes `warning:"unusually_fast"`.
Train/Drill: same endpoint with `kind:"train"|"drill"`; response omits `words` unless requested `?include=words`.

### `GET /attempts/?twister=&kind=&page=` 🔐 · `GET /attempts/{id}/` 🔐 (includes `words[]`) · `DELETE /attempts/{id}/` 🔐 (recomputes stats).

### `POST /attempts/sync/` 🔐 — batch upload of offline/guest attempts (max 50), each with its own `client_attempt_id`; returns per-item results `{status:"created|duplicate|rejected", …}`.

## 6. Media & recordings

### 6.1 Create & upload (resumable)

**Step 1** `POST /recordings/` 🔐 → `201`
```json
{ "twister":"fuzzy-wuzzy","session_id":"…","layout":"camera_text","has_camera":true,"has_screen":false,"has_mic":true,
  "duration_ms":41200,"width":1280,"height":720,"fps":30,"mime_type":"video/webm;codecs=vp9,opus","size_bytes":9215032,
  "title":"Fuzzy Wuzzy — 29 Sep","consent":{"recording_upload":"v1"} }
```
Response:
```json
{ "id":"9a1…","status":"uploading",
  "upload":{"provider":"supabase","bucket":"recordings","path":"<uid>/2026/09/<asset>.webm",
            "signed_url":"https://…/upload/resumable","token":"…","expires_in":3600,"chunk_size":6291456},
  "quota":{"used_bytes":10485760,"limit_bytes":104857600,"count":2,"count_limit":5} }
```
Errors: `402 quota_exceeded` (bytes or count) · `403 consent_required` · `403 minor_not_allowed` · `413 too_large` (server-side max size) · `415 unsupported_media_type`.

**Step 2** Client uploads to Storage with a TUS client (retry/back-off, resumable across reloads via stored `upload` metadata).

**Step 3** `POST /recordings/{id}/complete/` 🔐 with `{ "size_bytes":9215032,"checksum_sha256":"…","thumbnail":"data:image/jpeg;base64,…"|null }` → server `HEAD`s the object, verifies size/mime/checksum, sets `status:"uploaded"` → enqueues processing → `202`.
Idempotent; safe to call repeatedly.

### 6.2 Read / manage
| Endpoint | Notes |
|---|---|
| `GET /recordings/?twister=&page=` 🔐 | Owner's list (thumbnail signed URLs, 15 min) |
| `GET /recordings/{id}/` 🔐 | Full detail incl. `attempt`, `words[]`, `captions_url`, `playback:{url,expires_at,mime}` |
| `PATCH /recordings/{id}/` 🔐 | `title`, `visibility`, `notes`, `expires_at` (≤ plan max) |
| `POST /recordings/{id}/analyse/` 🔐 | Runs Speak & score analysis on the uploaded audio (worker engine) → returns/creates an Attempt (`kind:"record"`) → `202` + poll |
| `DELETE /recordings/{id}/` 🔐 | Soft delete (24 h undo via `POST …/restore/`) then hard delete |
| `GET /me/storage/` 🔐 | `{used_bytes,limit_bytes,count,count_limit,expiring_soon:[…]}` |
| `POST /recordings/{id}/retry-processing/` 🔐 | Only when `failed` |

### 6.3 Voice clips (opt-in cloud copy of Speak & score audio)
`POST /voice/` (same 3-step pattern, `kind:"audio"`, ≤ 2 MB, ≤ 60 s) → returns `voice_asset_id` to attach to an attempt. Auto-expires in 30 days.

## 7. Sharing

| Endpoint | Behaviour |
|---|---|
| `POST /recordings/{id}/share/` 🔐 `{ "expires_in":"7d" }` → `201 {"url":"https://twister.meetpawan.com/r/<token>","expires_at":…}` | Token shown **once**; only its hash is stored. Blocked for minors / unprocessed / reported items (`409`) |
| `DELETE /shares/{id}/` 🔐 | Revoke immediately |
| `GET /shares/?recording=` 🔐 | Owner's links with `view_count` |
| `GET /public/r/{token}/` 🔓 | Returns `{title,twister,duration_ms,score?,captions_url?,playback:{url,expires_at},owner:{display_name?}}` with a **≤ 15 min signed media URL**. `404` unknown, `410` expired/revoked. Rate-limited, `X-Robots-Tag: noindex`, no owner email/PII |
| `POST /public/r/{token}/report/` 🔓 | `{reason,details}` → `ModerationReport`; auto-hides after N=3 distinct reports pending review |
| `POST /attempts/{id}/score-card/` 🔐 | Generates share short-link + image URLs |
| `GET /public/s/{token}/` 🔓 | Score card metadata for OG rendering |

## 8. Progress & gamification

| Endpoint | Response |
|---|---|
| `GET /me/summary/` 🔐 | `{mastered:12,total:205,current_streak:4,best_streak:6,streak_at_risk:true,achievements:{unlocked:6,total:24},xp:420,level:3}` |
| `GET /me/stats/?range=30d&mode=` 🔐 | KPIs, series for charts, `weak_words:[{"word":"pickled","miss_rate":0.62,"seen":21}]`, category accuracy |
| `GET /me/achievements/` 🔐 | Catalogue with `unlocked_at`, `progress` |
| `GET /me/activity/?weeks=12` 🔐 | Heatmap data (`local_date`, attempts, active_ms) |
| `POST /me/timezone/` 🔐 | `{ "timezone":"Asia/Kolkata" }` (validates IANA) |
| `GET /me/favorites/` 🔐 | Paginated twisters |

## 9. Generate Twister

`POST /twisters/generate/` 🔐 (age-gated) `Idempotency-Key` required
```json
{ "sounds":["s","sh"],"difficulty":3,"length":"medium","theme":"beach","tone":"silly" }
```
→ `201`
```json
{ "generation_id":88,"twister":{"slug":"gen-4f2a…","text":"…","difficulty":3,"tip":"…","focus_sounds":["s","sh"],"visibility":"private","source":"ai"},
  "quota":{"remaining_today":7} }
```
Errors: `422 unsafe_prompt` · `422 low_quality` (after one automatic retry) · `429` · `503 generator_unavailable`. `POST /twisters/{slug}/save/` toggles keep vs. discard (unsaved AI twisters are purged after 24 h).

## 10. Consent & privacy

| Endpoint | Purpose |
|---|---|
| `POST /me/consents/` `{ "type":"recording_upload","version":"v1" }` | Record consent |
| `DELETE /me/consents/{type}/` | Revoke (triggers purge of dependent media after 24 h) |
| `GET /me/export/` | Async data export (zip: JSON + media links), emailed |
| `DELETE /me/` | Account deletion request (30-day grace, then purge) |

## 11. Webhooks / worker callbacks (internal)
`POST /internal/media/{asset_id}/processed/` (HMAC-signed) with `{status,duration_ms,width,height,thumbnail_path,captions_path,error}`; retries with exponential back-off; idempotent.

## 12. Security checklist
- JWT verified per request (JWKS/HS256), `sub` → Profile; deny soft-deleted profiles.
- Object-level authorization on every `{id}` route (owner or valid share token).
- Signed URLs ≤ 1 h (upload) / ≤ 15 min (playback); never log URLs/tokens.
- Upload MIME/size sniffing server-side after upload (first bytes) — reject non-video/audio.
- CORS allow-list; no wildcard; `Vary: Origin`.
- Input limits on all free-text fields; HTML escaped on render; titles ≤ 80 chars.
- Abuse throttles + per-user quotas; admin kill switches via feature flags.


## 13. Additions for the in-house engine and the ERD review
| Endpoint | Purpose | Notes |
|---|---|---|
| `GET /engine/manifest/` | Current `AcousticModelVersion` (name, size, sha256, URL in our storage, `label_map_version`), active `ScoringProfile` (thresholds, accent packs) and lexicon version for clients | Cacheable; clients verify sha256 before using a model; supports staged rollouts |
| `POST /attempts/` | Extended: accepts `engine`, `model_version`, `scoring_profile`, `nonce`, `audio_sha256`, `quality`, `words[]` with `phonemes[]` (device results) | Server validates schema, nonce and plausibility; stores as `verification_status=device` |
| `POST /attempts/{id}/audio/` | Optional consented upload of ≤ 60 s 16 kHz mono audio for a spot-check or a worker score | `voice_processing` consent required; presigned upload; audio auto-deleted after scoring (24 h max) |
| `POST /attempts/{id}/spot-check/` | (internal) enqueue `ScoringJob`; worker posts back through `POST /internal/scoring-jobs/{id}/result/` | Worker auth by signed token; idempotent |
| `GET /attempts/{id}/` | Includes `verification_status`, `engine`, `model_version`, `words[]` (+ `reason`, `acoustic_score`), `phonemes[]` (verdict, heard, delta) | |
| `POST /attempts/{id}/words/{i}/feedback/` | `judged_correct`, optional comment, optional audio donation flag | Rate-limited; feeds calibration |
| `GET /me/words/weak/?limit=` | Weak-word queue (UserWordStat, spaced review) | Powers "Practice by word" |
| `GET /me/sounds/` | Weak sound pairs (UserPhonemeStat) | Stats page |
| `POST /sync/guest/` | Idempotent import of guest attempts/favourites/prefs | `client_batch_id`; returns counts + rejected |
| `GET /me/entitlements/` | Plan limits + remaining quota (recordings, storage) | UI shows before users hit a wall |
| `GET /daily/` | Daily twister for `day` | Cached; UTC midnight rollover |
| `GET /leaderboard/weekly/?twister=` | Top N + my rank | P5, verified-only, respects `hide_from_boards` |
| `PUT /me/notifications/` | Reminder channels (email/webpush) | Unsubscribe by token link, no login |
Error codes added: `nonce_invalid`, `audio_hash_duplicate`, `model_unsupported` (client should fall back to Tier 0), `worker_busy` (device result stands), `consent_required`.
