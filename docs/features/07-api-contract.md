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
**As built (06b):** `sync` takes `{attempts:[<same body as POST /attempts/> + occurred_at]}` and returns `{results[], counts:{created,duplicate,rejected}, profile}`. Items are applied oldest-first by `occurred_at` (accepted from `ATTEMPT_MAX_BACKDATE_DAYS` ago to +5 min) so personal bests, streak days and mastery replay in order; each item is its own savepoint, and a rejected item carries `reason` (`invalid` + `fields`, or an error code). Successful create responses also carry `verification_status`, `focus_gated`, `mastered_now` and `warning`; `words[]` rows add `spoken_index`, `reason` (`homophone|focus_swap`), `confidence`, `acoustic_score`, `phonemes[]`. `Idempotency-Key` is accepted as an alias of `client_attempt_id`. Errors use the shared envelope; 06b adds `model_unsupported` (422), `nonce_invalid`, `audio_hash_duplicate` and `consent_required` (403).

**Part-twister attempts (Train / Drill):** `POST /attempts/` accepts `segment:{start,end}` — scoring-token indexes `[start, end)` of the twister — with `kind` `train|drill` and the text engine only. The transcript is scored against just those words, so unspoken words are never recorded as missed; `breakdown.words` keeps whole-twister indexes; XP is scaled by the share of the twister practised; drills are exempt from the repeated-transcript spam rule. Invalid ranges → `400 {segment}`.

Also shipped: `GET /me/words/weak/?due=1&limit=` → `{results:[{word, seen, miss_rate, weakness, next_review_at, respelling, drill}]}` where `drill` is `{twister, start, end, context[], context_index}` (a twister and position to drill the word in — the one the user last said it in, else any published twister containing it) or `null` · `GET /me/sounds/?limit=` → `{results:[{pair, target, heard|null, occurrences, errors, error_rate}]}` · `GET /engine/manifest/` (`model` and `scoring_profile` are `null` until a model is published or while `accurate_mode` is off) · `POST /attempts/{id}/words/{target_index}/feedback/` `{judged_correct?, comment?, donated_audio?}` (donation → `403 consent_required` until 06c).


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

## 14. As built (06c) — where behaviour differs from §6, §7, §10, §11

The retired 06c build spec (git history) is superseded by the notes below, which are the exact shapes shipped.

**§6 Recordings.** `POST /recordings/` gates in this order: flag `record_cloud` (`403 feature_disabled`) → `age_band` (`403 age_required` if unknown, `403 minor_not_allowed` if under 13) → `recording_upload` consent at the current version (`403 consent_required`) → `415`/`413` → plan limits (`402 quota_exceeded`, `details.limit` = `storage_bytes` | `recordings` | `recording_ms`). Idempotent on `client_recording_id` (or the `Idempotency-Key` header): replay → `200`, `Idempotent-Replay: true`, same recording, freshly signed `upload`. Response: `{"recording":{…list shape…},"upload":{provider,bucket,path,signed_url,token,expires_in,chunk_size,standard_url}|null,"quota":{used_bytes,limit_bytes,count,count_limit}}` (`upload` is `null` once the upload is no longer pending). `complete` body: `{size_bytes?, checksum_sha256?, thumbnail?}`; the stored size is authoritative and reconciled into the ledger. Returns the detail shape with `202` (first time) or `200` + `Idempotent-Replay` (repeat). `409 upload_incomplete` = object not stored yet (retry); `422 upload_rejected` `{details.reason}` = content sniff / checksum / size failed (recording becomes `failed`, bytes released, object deleted); `402` if the real size no longer fits. `expires_at` is set at `complete`. List row fields: `id, client_recording_id, twister (slug), twister_text, session_id, attempt_id, title, notes, layout, layout_settings, crop_rect, trim_start_ms, trim_end_ms, has_camera, has_screen, has_mic, has_system_audio, duration_ms, width, height, fps, mime_type, size_bytes, capture_source, status, failure_reason, recovered, captions_source, visibility, ended_reason, consented_at, expires_at, deleted_at, hidden_at, created_at, thumbnail_url`; detail adds `attempt {id,public_id,kind,score,accuracy,wpm,duration_ms,created_at}|null`, `words[] {target_index,target,spoken,status,reason,start_ms,end_ms}`, `playback {url,expires_at,mime}|null` (only when `ready`) and `captions_url`. `PATCH` accepts `title, notes, visibility (private|unlisted), expires_at, attempt (attempt id|null), trim_start_ms, trim_end_ms, crop_rect {x,y,w,h}, layout_settings` and returns the detail shape. `DELETE` → `200 {id, deleted_at, restorable_until}`; `POST …/restore/` → detail, `410` after 24 h, `402` if no slot. Analysis scoring stays a normal `kind=record` attempt (accepted by `POST /attempts/`) linked through `attempt`; `POST /recordings/{id}/analyse/` (below, §14.1) only prepares the audio for the future scoring worker. `GET /me/storage/` = `{used_bytes,limit_bytes,count,count_limit,expiring_soon:[{id,title,expires_at}]}` (expiring within 3 days); `GET /me/entitlements/` adds `usage:{used_bytes,count}`.

**§6.3 Voice.** `POST /voice/ {mime_type,size_bytes,duration_ms}` → `201 {voice_asset_id,status,expires_at,upload,quota}`; `POST /voice/{asset_id}/complete/ {checksum_sha256?}` → `202` (`200` on repeat) `{voice_asset_id,status:"ready",expires_at}`. Needs `record_cloud`, age 13+, `voice_storage` consent; clips over the plan's `voice_clip_ms_max`/`voice_clip_bytes_max` → `413`. `voice_asset_id` on `POST /attempts/` must be the caller's own ready clip (else `400`).

**§7 Sharing.** `POST /recordings/{id}/share/ {expires_in:"24h"|"7d"|"30d"}` → `201 {id,url,expires_at}` (token only in `url`); over the plan's `share_max_days` → `402 quota_exceeded` (`details.limit = share_max_days`); not ready / hidden / reported → `409`; needs `share_links` and age 13+. `GET /shares/?recording=` is paginated `{id,target_type,target_id,expires_at,revoked_at,view_count,last_viewed_at,created_at,active}`; `DELETE /shares/{id}/` → `204`. `GET /public/r/{token}/` → `{title,twister{slug,text},duration_ms,trim_start_ms,trim_end_ms,score?,captions_url?,playback{url,expires_at,mime},owner{display_name}}`, always `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`; `404` unknown, `410` expired / revoked / held / target deleted, hidden or not ready (body carries no metadata), `403 feature_disabled` when the `share_links` kill switch is off. `POST /public/r/{token}/report/ {reason: abuse|sexual|minor|privacy|spam|other, details?}` → `201` (`200` for a repeat reporter) `{id,reason,created_at}`; three distinct reporters put the link on hold. `POST /attempts/{id}/score-card/` → `201 {id,url,expires_at}` (`…/s/<token>`); `GET /public/s/{token}/` → `{score,accuracy,wpm,kind,twister{slug,text},words[{target,status}],created_at}` (no media, no owner).

**§10 Consent.** `GET /me/consents/` → `{results:[{type,version,granted_at,revoked_at,current}],current_versions:{type:version}}`; `POST` `{type,version}` → `201` (`200` + `Idempotent-Replay` when the same version is already active; a newer version retires the old row); `DELETE /me/consents/{type}/` → `200 {type,revoked_at,purge_at}`. `PATCH /me/ {age_band}` (`unknown|under13|13plus`) is settable once (`409` afterwards). Word-feedback audio donation now needs `model_improvement` consent (`403 consent_required`) and a non-minor account (`403 minor_not_allowed`).

**§11 Worker callback.** Worker endpoints are specified in §14.1 (claim / heartbeat / processed); signing is unchanged (`X-Worker-Signature: sha256=<hmac of the raw body with WORKER_SHARED_SECRET>`, `503` if no secret, `403` on a bad signature).

**New error codes.** `feature_disabled` (403), `age_required` (403), `minor_not_allowed` (403), `upload_incomplete` (409), `upload_rejected` (422), plus the contract's `quota_exceeded` (402, `details.limit`) and `dependency_unavailable` (503, storage outage).

### 14.1 Worker queue, analysis, reminders, privacy (addendum A2)

The worker's JSON shapes live in `worker/twister_worker/models.py` and `api/twisters/media/jobs.py`; summary of what shipped:

- **Queue.** `MediaJob {id, recording, asset, kind process|analyse, status queued|running|done|failed, tries, max_tries (3), locked_until, error_code}`; one active job per `(recording, kind)` (partial unique index) so enqueue is idempotent. `complete` (and `retry-processing`) enqueue a `process` job when `MEDIA_PROCESSING_ENABLED=1`.
- **`POST /internal/media/claim/`** (HMAC, body `{}`) → `200 {"job": null}` or `{"job": {id, kind, recording_id, asset_id, lease_s, source{url,mime,size_bytes}, outputs{mp4?,thumbnail?,captions?,audio?: {bucket,path,upload_url,token,mime}}, words[{target,start_ms,end_ms,status}]|null, limits{max_height,max_s}}}`. PostgreSQL claims with `FOR UPDATE SKIP LOCKED`; every database also wins the job with one conditional `UPDATE`. A lapsed lease is recovered at the start of the next claim.
- **`POST /internal/media/jobs/{id}/heartbeat/`** → `200 {job_id, lease_s, locked_until}`; `409 lease_lost` once the job is no longer running; `404` unknown.
- **`POST /internal/media/{asset_id}/processed/`** body `{job_id, status ready|failed, duration_ms?, width?, height?, outputs: ["mp4","thumbnail","captions"|"audio"], error?, retryable?}` → `200 {status, job_status}` (`Idempotent-Replay` on a repeat). The API derives each output path itself (`uuid5(job.id, slot)`), stats and sniffs it, registers the assets, charges the ledger, swaps in the transcode (the original is deleted and its bytes released) and sets `captions_source="alignment"`. `409 upload_incomplete` (declared output missing), `422 upload_rejected`, `409 job_closed` (contradicting report for a settled job), `410` (recording gone). Failed + `retryable` (default) with tries left re-queues; otherwise the job and its recording fail (`failure_reason = error`). The old `thumbnail_path`/`captions_path` body fields are ignored.
- **`POST /recordings/{id}/analyse/`** 🔐 → `202 {"analysis": {"status": "queued|running|ready|failed", "audio_ready": bool}}`, `200` + `Idempotent-Replay` if a job is waiting or the audio exists. Gates: `record_cloud` (403 `feature_disabled`), 13+ (`age_required` / `minor_not_allowed`), `voice_processing` consent (`consent_required`), `MEDIA_PROCESSING_ENABLED` (403 `feature_disabled`), recording `ready|processing` (else 409). Recording **detail** gains `analysis {status: "none|queued|running|ready|failed", audio_ready}`; `none` = never requested or audio purged.
- **Sweeper.** `orphan_sweeper` also re-queues lapsed leases / fails jobs over `max_tries` (the recording becomes `failed`, reason `lease_expired`), cancels jobs of hard-deleted takes and deletes originals already replaced by a transcode.
- **Expiry reminder.** `expire_recordings` e-mails one message per user covering every ready take expiring within `EXPIRY_REMINDER_DAYS` (3), once, tracked by `Recording.reminder_sent_at` (renamed from `expiry_reminded_at`); profiles without an e-mail are skipped. Transactional, links to `/recordings`, no tokens/URLs.
- **`GET /me/` / `PATCH /me/`** gain `public_name` (string, ≤ 40, default `""`, opt-in). Trimmed/collapsed; rejected with `400 validation_error` if it has control characters, e-mail/link/markup characters or a blocked term. `owner.display_name` on `GET /public/r/{token}/` is **only** `public_name` (`null` when blank); the account display name and e-mail are never exposed.
- **Opaque paths.** New objects live at `{hmac(profile_id)[:16]}/{yyyy}/{mm}/{asset_id}.{ext}` (`MEDIA_PATH_SECRET`); older assets keep their stored path. Storage RLS is deny-all for clients (`storage_policies.sql`); uploads use API-minted signed upload tokens, playback signed URLs.
- New error codes: `409 lease_lost`, `409 job_closed`.

---

## 15. As built (06d core)

Decisions: D16–D19 in `11`. Shapes below are what ships; where they differ from earlier sections of this file, this section wins.

### Endpoints

| Endpoint | Auth | Shape |
|---|---|---|
| `GET /me/summary/` | yes | `{mastered,total,current_streak,best_streak,streak_at_risk,streak_freezes,next_streak_milestone,practised_today,achievements:{unlocked,total},xp,level,xp_in_level,xp_for_next_level,timezone,today,unseen_achievements:[{code,name,description,icon,tier,xp_reward,unlocked_at}]}`. `current_streak` is the effective streak (0 once lapsed; the stored value is untouched). `private, no-store`. |
| `GET /me/achievements/` | yes | `{unlocked,total,results:[{code,name,description,icon,tier,category,xp_reward,unlocked_at,progress,seen}]}` ordered by `sort_order`. Locked `hidden` rows are masked: name `"Secret achievement"`, description `"Keep practising to find it."`, icon `"lock"`, `progress: null`. |
| `POST /me/achievements/seen/` | yes | Body `{codes?: [..]}` (omit = all unseen, at most `ACHIEVEMENT_SEEN_MAX_CODES`). `200 {"marked": n}`. Unknown codes are ignored. |
| `GET /me/stats/?range=7d\|30d\|90d\|all&mode=speak_score\|read_along\|record` | yes | `{range,mode,from,to,kpis:{attempts,practice_ms,avg_score,best_streak,mastered,xp,level},score_series,speed_series,attempts_by_day,category_accuracy,weak_words}` as in spec §4.1. Days are local dates. `rolling` is a 7-day trailing mean weighted by `count`. Series are capped at `STATS_MAX_POINTS`; a longer `all` range is bucketed by ISO week (`date` = Monday). Bad `range`/`mode` gives `400 validation_error`. |
| `GET /me/activity/?weeks=12` | yes | `weeks` 1-52. `{from,to,days:[{date,attempts,active_ms,read_along_ms,qualifies_streak,freeze_used}]}`; only days with a row, oldest first. |
| `GET /me/favorites/` | yes | Paginated Twister list (same serializer and context as Browse), newest favourite first. |
| `PUT` / `DELETE /me/favorites/{slug}/` | yes | Idempotent, `200 {"is_favorite": bool}`. Unknown or unpublished slug is `404`. The old `POST /twisters/{slug}/favorite/` toggle remains. |
| `GET /daily/?day=YYYY-MM-DD` | no | `{day,source:"auto"\|"editorial",twister}`. Default is today in UTC; `day` may be today or up to `DAILY_LOOKBACK_DAYS` (60) back. Only ASCII `YYYY-MM-DD` is accepted. `public, max-age=60`. `GET /twisters/daily/` delegates to the same service. |
| `GET /twisters/facets/` | no | `{total,levels,categories,origins}`. Takes the list filters except `status`/`sort`; each facet ignores its own filter. Anonymous: `public, max-age=60, stale-while-revalidate=300`. |
| `GET /twisters/random/` | no | One Twister. Params `difficulty`, `category`, `origin`, `exclude=a,b` (at most `RANDOM_EXCLUDE_MAX`). Signed-in picks a bucket by `RANDOM_WEIGHTS` (empty buckets dropped, weights renormalised). Empty set is `404 not_found`. `no-store`. |
| `GET /leaderboard/weekly/?twister=<slug>` | no | Flag `weekly_boards` off is `403 feature_disabled`; under-13 viewer is `403 minor_not_allowed`. `{week_start,week_end,twister:{slug,text},top:[{rank,name,emoji,score,achieved_at,is_me}],me:{rank,score}\|null,hidden,updated_at}`. Reads `LeaderboardEntry` only. |
| `GET /twisters/{slug}/leaderboard/` | no | Shape unchanged. `user` now comes from the board name (D18); opted-out and under-13 profiles are excluded. |

### Changed existing contracts

- `GET /twisters/`: new `status=mastered|in_progress|not_started|favorites` (anonymous gets `400 validation_error`), `sort=recommended|newest|shortest|longest|hardest|easiest|best_desc|best_asc` (wins over `ordering`; unknown is 400) and `q` (alias of `search`). `best_*` sorts use a subquery on the caller's best test score.
- `Twister.mastery`: `"new"|"practising"|"almost"|"mastered"` for signed-in callers, `null` for anonymous.
- `GET/PATCH /me/`: `hide_from_boards` (writable), `streak_freezes` (read-only). Timezone stays on `PATCH /me/`; no separate timezone endpoint.
- Attempt responses (`POST /attempts/`) and the `PATCH /sessions/{id}/` response carry `achievements_unlocked: [{code,name,description,icon,tier,xp_reward}]` (empty list on replay). The session response also carries `xp_awarded`. Badge XP is added to the profile total, so `profile.xp` can exceed the attempt's own `xp_awarded`.
- Recording `complete` evaluates achievements server-side; its response is unchanged (the next `GET /me/summary/` shows the unseen badge).
- Level maths lives in `twisters/levels.py` (`XP_PER_LEVEL = 200`).

### Deviations and notes

- No `level` alias on the twister list: `difficulty` is the established name.
- Catalogue size is 25 (seeded by `0013_progress_seeds`; `sync_achievements` re-applies edits).
- `LeaderboardEntry` has an extra `built_at` column. Hourly rebuild: `build_leaderboard` (cron `37 * * * *` in `manage-command.yml`).
- Seed flags: `achievements` on, `weekly_boards` off.
- Achievements are evaluated in-request inside a savepoint; errors are logged and swallowed (D19). Unlocks are never auto-revoked.

## 16. As built (round 1) — score cards, account deletion and export, night owl

Decisions D20-D23 (`11`). All paths are under `/api/v1`.

### New endpoints

| Endpoint | Auth | Behaviour |
|---|---|---|
| `GET /public/s/{token}/image.png?size=og\|square` | no | The score-card picture (PNG). `og` = 1200x630 (default), `square` = 1080x1080; any other `size` is `400 validation_error`. Resolved by the same function as `GET /public/s/{token}/`, so `404` (unknown token or a recording token), `410` (expired, revoked, held, attempt deleted) and `403 feature_disabled` (`score_cards` off) match it exactly. `200` carries `Content-Type: image/png`, `Cache-Control: public, max-age=3600` (`SCORE_CARD_IMAGE_MAX_AGE_S`), a strong `ETag` (hash of the picture's inputs plus a render version), `X-Robots-Tag: noindex, nofollow`; `If-None-Match` (`*`, a list, weak forms) gets `304` without rendering. Errors are `no-store`. `Accept` is ignored (an `<img>` or a crawler never gets a 406). Does not count as a view. Throttled by `share_resolve` (60/min/IP). |
| `GET /me/export/` | yes | `200 application/json` download `twister-export-YYYYMMDD.json`, `Cache-Control: private, no-store`, throttle `export` 3/hour/user (`429 rate_limited`). Body `{schema_version:1, generated_at, truncated, profile, preferences\|null, favorites:[slug], attempts:[{id,twister,kind,transcript,accuracy,speed_score,fluency_score,completeness,duration_ms,long_pause_ms,wpm,score,score_version,xp_awarded,is_personal_best,breakdown,created_at,words:[{target_index,spoken_index,target_word,spoken_word,status,reason,credit,start_ms,end_ms}]}], sessions, daily_activity, stats:{twisters,words,phonemes}, achievements:[{code,unlocked_at}], recordings:[metadata only], consents:[{type,version,granted_at,revoked_at}]}`. Streamed in chunks (`EXPORT_CHUNK_SIZE`); at most `EXPORT_MAX_ATTEMPTS` attempts, newest first. Never contains other users' data, token hashes, `ip_hash`, storage buckets/paths, signed URLs, nonces, audio hashes or worker/scoring internals (explicit whitelists in `account/export.py`). |
| `DELETE /me/` | yes | Body `{"confirm":"DELETE"}` (anything else `400`). `202 {deletion_requested_at, deletion_scheduled_for}`; asking again while pending returns the same dates. |
| `DELETE /me/deletion/` | yes | Cancel. `200 {deletion_requested_at:null, deletion_scheduled_for:null}`; idempotent; allowed until the purge runs, even after the scheduled date. (Chosen over `POST /me/deletion/cancel/`.) |

### Changed existing contracts

- `GET /public/s/{token}/` gains `owner: {"display_name": <public_name or null>}` (never the account name or e-mail) and `images: {"og","square"}` (absolute URLs from `API_PUBLIC_URL`; the key is omitted while that is unset).
- Score-card endpoints (`POST /attempts/{id}/score-card/`, both public ones) check flag `score_cards`; `share_links` is for recordings only.
- `GET/PATCH /me/`: `night_owl` (writable), `deletion_scheduled_for` (read-only, `null` unless pending). `GET /me/summary/` carries `night_owl` and `deletion_scheduled_for`; `today` is the night-owl-shifted streak day.
- **Pending accounts**: in the authentication step, a profile with `deletion_requested_at` may use safe methods, `DELETE /me/`, `DELETE /me/deletion/` and `GET /me/export/`; every other write (including `PATCH /me/`) is `403 account_pending_deletion` with `error.details.scheduled_for`.
- Boards (weekly and per twister) and expiry reminders exclude pending profiles through `Profile.objects.active()` / `models.active_profile_q(prefix)`.
- Catalogue is 27: `night_owl` "Night Owl" and `early_bird` "Early Bird" (bronze, skill, icons `moon`/`sunrise`, 20 XP, rule `attempt_local_hour` with `from`/`to` hours, `to` exclusive, wraps midnight). Both need `timezone != "UTC"`.

### Jobs, settings, migrations

- `manage.py purge_deleted_accounts` (workflow allow-list, cron `53 * * * *`): per due profile, in one transaction, media objects first (`recordings.purge_all_media`, the same passes as `expire_recordings`), then the Profile (cascade), then `AuthAdmin.delete_user` (`DELETE {SUPABASE_URL}/auth/v1/admin/users/{id}`, a 404 counts as success; with no `SUPABASE_SERVICE_ROLE_KEY` it logs a warning and skips). Any failure rolls that account back to pending; the next run retries. Output `purged=N, deferred=N, skipped=N`.
- New settings: `API_PUBLIC_URL`, `SCORE_CARD_IMAGE_MAX_AGE_S`, `ACCOUNT_DELETION_GRACE_DAYS` (30), `EXPORT_MAX_ATTEMPTS` (20000), `EXPORT_CHUNK_SIZE` (500), `NIGHT_OWL_CUTOFF_HOUR` (3); throttle rate `export` = `3/h`. New dependency: `pillow`.
- Migrations: `0014_account_night_owl_schema` (`Profile.night_owl`, `deletion_requested_at`, `deletion_scheduled_for`, CHECK `profile_deletion_window`: both null, or both set with scheduled >= requested) and `0015_round1_seeds` (flag `score_cards` on; the two badges). Schema and seeds are separate (same reason as 0007/0008, 0012/0013); both reverse cleanly with data present (tests in `tests/test_round1_migrations.py`). Deploy order: migrate, then API, then set `API_PUBLIC_URL`; add the `purge_deleted_accounts` cron (already in `manage-command.yml`).

### Deviations and notes

- Score-card fonts (DejaVu Sans, Sans Bold, Bitstream Vera licence, redistribution allowed) are bundled in `twisters/assets/fonts/` with `LICENSE.txt`.
- Night owl SQL bucketing (stats charts) shifts by a fixed duration, so on the two DST-change nights a chart can put an attempt next to the boundary on the neighbouring day; streaks use exact wall-clock arithmetic and are unaffected.
- Links revoked by a deletion request stay revoked after a cancel.
- Export is streamed; serverless hosts that buffer responses are limited by their response size cap (Vercel: 4.5 MB). Lower `EXPORT_MAX_ATTEMPTS` or move the endpoint if an export can exceed it.

## 17. As built (round 2) — Generate Twister

Decisions D24-D26 (`11`). All paths are under `/api/v1`. Reminders are §18.

### Endpoints

| Endpoint | Auth | Behaviour |
|---|---|---|
| `POST /generate/` | yes | Body `{topic, difficulty?, language?}`: `topic` string, 2-120 characters after cleaning (control, format and invisible characters removed, whitespace collapsed; a raw value over 120 or containing NUL is `400`), `difficulty` 1-4 (default 2; the catalogue has four levels), `language` `"en"` (default). `201` with the new twister (shape below) plus `quota`. Gates in order: throttle (`429 rate_limited`, 3/min/user) → flag `generate_twister` (`403 feature_disabled`) → body (`400 validation_error`) → age (`403 minor_not_allowed` for `under13`) → topic blocklist (`422 generation_rejected`, `details.reason = topic_not_allowed`, costs nothing) → daily quota (`429 generation_limit`) → provider (`503 generator_unavailable`) → output checks (`422 generation_rejected`). A reserved slot is handed back unless a twister is stored. |
| `GET /me/twisters/` | yes | The caller's generated twisters, newest first, paginated like every list (`{count,next,previous,results}`) with one extra key `quota`. Works while the flag is off. |
| `DELETE /me/twisters/{id}/` | yes | `204`. Removes the twister with the caller's attempts, stats and favourites of it. Someone else's id, a public twister's id or an unknown id is `404`. `409 conflict` while a recording of it still exists (delete the recording first; deleting would orphan stored media). Works while the flag is off. The daily quota is **not** refunded. |

**Generated twister** (`201` body and every `results[]` row of `GET /me/twisters/`): the catalogue shape `{slug,text,category,difficulty,difficulty_label,origin,tip,focus_sounds,word_count,visibility,is_favorite,best_score,mastery}` plus `id`, `topic`, `created_at`. `category` is `null`, `origin` is `modern`, `visibility` is `private`, `slug` is `my-` + 12 hex characters. `POST` adds `quota`.

**`quota`**: `{limit, used, remaining, resets_at}`; `limit` is `GENERATE_DAILY_LIMIT` (5), the day is the **UTC** day, `resets_at` is the next UTC midnight (ISO 8601). A slot counts only when a twister is created. A rejected result and a provider outage (`503`) do not. `429 generation_limit` carries `error.details = {limit, used, resets_at}`.

**`422 generation_rejected`**: `error.details.reason` is one of `topic_not_allowed`, `provider_blocked`, `empty_output`, `malformed_output`, `too_short`, `too_long`, `too_few_words`, `too_many_words`, `unsupported_characters`, `blocked_content`, `unknown_words`. The message is generic; neither the topic nor the model's output is ever echoed.

### Changed existing contracts

- `Twister` objects (every endpoint that returns one) gain `visibility: "public" | "private"`.
- `GET /twisters/{slug}/` and `GET /twisters/{slug}/history/` also serve the caller's **own** private twisters (`Cache-Control: private, no-store` on a private one). Anyone else, signed in or not, gets the same `404 not_found` as for a slug that does not exist.
- Every other twister path is the public catalogue only: `GET /twisters/` (and `search`, `q`, `sort`, filters), `/twisters/facets/`, `/twisters/random/`, `/twisters/daily/`, `/daily/`, `/categories/` counts, `/me/summary/` `total` and `mastered`, `/twisters/{slug}/leaderboard/`, `/leaderboard/weekly/`, favourites (`PUT /me/favorites/{slug}/` on a private slug is `404`), guest sync, weak-word drill fallbacks (a drill may only point at a private twister of the caller's own history), the engine manifest's lexicon version.
- `POST /attempts/`, `POST /attempts/sync/`, `POST /sessions/` and `POST /recordings/` accept a private `twister` slug only from its owner; for anyone else it is `400 validation_error` ("does not exist").
- `GET /me/export/` gains `generated_twisters: [{slug,text,topic,tip,focus_sounds,difficulty,created_at}]` (after `daily_activity`; `schema_version` stays 1, the change is additive).
- Public recording and score-card pages still show the twister text of what the owner chose to share, whatever its visibility.

### Settings, flag, migration

- Settings: `GEMINI_API_KEY` (secret), `GEMINI_MODEL` (`gemini-2.5-flash`), `GEMINI_TIMEOUT_S` (10), `GENERATOR_BACKEND` (`gemini` | `fake`; blank = `gemini` with a key, `fake` without), `GENERATE_DAILY_LIMIT` (5); throttle rate `generate` = `3/min`.
- Flag `generate_twister` (seeded **off**, no new migration) gates `POST /generate/` only. To enable: set `GEMINI_API_KEY`, redeploy, then follow `15-rollout-and-flags.md` (allow-list first). Without a key the backend is `fake` and returns canned twisters; do not enable the flag for real users in that state.
- Migration `0016_round2_generate_schema`: `Twister.visibility` (default `public`), `Twister.owner` (nullable, cascade), `Twister.topic`, CHECK `twister_visibility_owner` (public and unowned, **or** private and owned and not `is_published`), and table `GenerationUsage(profile, day, count)` unique per profile and day. Existing rows become public and unowned. It reverses cleanly; after a reverse a private twister is just an unpublished row.
- A private twister is stored with `is_published = false`, so any older query that filters on `is_published` hides it by default. `Twister.objects.public()` / `.visible_to(profile)` (and `public_twister_q` / `visible_twister_q` for joins) are the only ways to read twisters; `tests/test_twister_privacy.py` fails if a module bypasses them.

## 18. As built (round 2) — practice reminders

Decision D27 (`11`). All paths are under `/api/v1`.

### Endpoints

| Endpoint | Auth | Behaviour |
|---|---|---|
| `GET /me/reminders/` | yes | `200 {"enabled": false, "hour_local": 18, "timezone": "Asia/Kolkata", "timezone_confirmed": true}`. A profile with no row reads as `enabled: false`, `hour_local: 18`. `timezone` is the profile's IANA zone (set through `PATCH /me/`); `timezone_confirmed` is `false` until a zone has been stored through `PATCH /me/` (any zone, `UTC` included; round 4, §19) (no mail is sent in that state, so the UI should ask for the zone first). Works while the flag is off. |
| `PUT /me/reminders/` | yes | Body `{enabled: bool, hour_local: 0-23}`, **both required** (a full replace). `200` with the same shape as `GET`. Anything else is `400 validation_error`. A profile pending deletion gets `403 account_pending_deletion` like every write. Works while the flag is off (the flag only gates *sending*). |
| `GET /public/unsubscribe/{token}/` and `POST /public/unsubscribe/{token}/` | none | One-click unsubscribe (RFC 8058). `200 {"unsubscribed": true}`; switches `enabled` off and keeps the hour. Idempotent, so a second call and a call for an account that has since been purged answer the same `200`. A malformed or tampered token is `404 not_found`. The `POST` body (`List-Unsubscribe=One-Click`) is ignored. `Cache-Control: no-store`, `X-Robots-Tag: noindex`; throttled per IP (`unsubscribe`, 600/min, because mail providers post from shared addresses). It works for an account pending deletion. |

### The e-mail

- Sent by `manage.py send_reminders` (hourly at `:07`, in the `manage-command.yml` allow-list and cron). Subject `Time for your Twister practice`, or `Keep your Twister streak going` when the person has a live streak. Text and HTML parts; the display name is HTML-escaped.
- Headers: `List-Unsubscribe: <{API_PUBLIC_URL}/api/v1/public/unsubscribe/{token}/>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The body also links to the web page `{WEB_BASE_URL}/unsubscribe/{token}` (web route `/unsubscribe/$token`, which calls the `POST` above), to `{WEB_BASE_URL}/account` and to `{WEB_BASE_URL}/`.
- `token` is the profile id signed with `SECRET_KEY` under the salt `twister.reminders.unsubscribe` (`django.core.signing`, `.` before the signature, URL-safe). It does not expire, carries nothing else and cannot be forged. Rotating `SECRET_KEY` invalidates tokens already mailed.

### Who is mailed, and when

All of: flag `reminders` on for that person (allow-list / rollout apply), `enabled`, not pending deletion, a non-blank e-mail, a confirmed timezone, the profile's **wall-clock** hour equal to `hour_local`, nothing practised on their streak day (`last_activity_date` or any `DailyActivity` row with an attempt), and `last_sent_on` not yet that streak day. Hour check: `localtime.local_hour` (real clock, so night owl mode does not move it); day: `localtime.local_date` (night-owl aware). DST: compared in the profile's own zone; if the chosen hour does not exist that day (spring gap) the next hour stands in; in the autumn overlap the hour happens twice but `last_sent_on` keeps it to one mail. The day is claimed with a conditional `UPDATE` before sending and released if delivery fails, so the next hourly run retries. Maximum one mail per person per day. The command refuses to run (`CommandError`) when `API_PUBLIC_URL` or `WEB_BASE_URL` is blank, and does nothing while the flag is off.

### Changed existing contracts

- `GET /me/export/` gains `reminders: {enabled, hour_local, last_sent_on, updated_at} | null` (after `preferences`; `schema_version` stays 1). The row is deleted with the account (FK cascade).

### Settings, flag, migration

- No new settings. Uses `EMAIL_*`, `DEFAULT_FROM_EMAIL`, `WEB_BASE_URL`, `API_PUBLIC_URL` (now also required by the `send_reminders` job: add the `API_PUBLIC_URL` secret to the GitHub `production` environment) and `SECRET_KEY`. Throttle rate `unsubscribe` = `600/min`.
- Flag `reminders` (seeded **off** in `0003`, no new data migration) gates sending only.
- Migration `0017_round2_reminders_schema`: table `ReminderPreference(profile 1-1 pk, enabled default false, hour_local default 18 with CHECK 0-23, last_sent_on date null, updated_at)`. Touches no existing rows; reverses by dropping the table.

### Deviations and notes

- "Verified e-mail" is "non-blank `Profile.email`" (taken from the Supabase token; Supabase confirms addresses on sign-up). The API stores no separate verified flag.
- Profiles whose timezone is still the `UTC` placeholder are not mailed (a wrong hour is worse than none). (Superseded in round 4, §19: confirmation is now the stored flag `Profile.timezone_confirmed`, so a person who confirmed the zone `UTC` is mailed.)
- Expiry reminders from `expire_recordings` are unrelated, transactional and not affected by this preference or flag.

## 19. As built (round 4) — hardening and loose ends

All paths are under `/api/v1`.

### CSP violation reports

| Endpoint | Auth | Behaviour |
|---|---|---|
| `POST /csp-report/` | none | Collects browser CSP reports. Accepts `application/csp-report` (`report-uri`, `{"csp-report": {...}}`), `application/reports+json` (`report-to`, a list of `{type: "csp-violation", body}`) and `application/json`. **Always `204`**, whatever the body (malformed, wrong type, over `CSP_REPORT_MAX_BYTES` = 16 KB, which is checked from `Content-Length` before the body is read). The only exception is the per-IP throttle (`csp_report`, 60/min), which answers the usual `429`. Nothing is stored. Each report logs one warning line `csp.violation directive=<name> blocked_host=<host>`: only the directive name and the host of the blocked URI (or a keyword such as `inline`/`eval`, or `other`); never a path, query string, document URL, referrer or script sample. A Reporting API batch is read up to 10 entries. |

The report-only CSP on JSON responses now ends with `report-uri /api/v1/csp-report/; report-to csp-endpoint` (each appended only if the configured `API_CSP_REPORT_ONLY` does not already name it) and the response carries `Reporting-Endpoints: csp-endpoint="/api/v1/csp-report/"`. A blank `API_CSP_REPORT_ONLY` still disables all of it. No new environment variable.

### Pending-deletion accounts on public endpoints

`OptionalJWTAuthentication` (used by the public report endpoint) treats a signed-in account that is pending deletion as **anonymous**, not `403 account_pending_deletion`: a public endpoint is open to everyone, so the write-block of §16 applies to the authenticated API only. Such a report is filed as an anonymous (IP-hash) report. Public `GET`s never needed this and are unchanged.

### Generate Twister limits

- `POST /generate/` checks the stored-twister cap right after the topic check and **before** a quota slot is taken: at `GENERATE_MAX_STORED` (default 50) private twisters it answers `409 stored_limit` with `error.details = {limit, stored}`; nothing is spent and the model is not called. Deleting a twister makes room (and still does not refund the daily quota). Under heavy concurrency one person could overshoot the cap by a request or two; this is a cost guard, not a security boundary.
- `quota` (on `POST /generate/` and `GET /me/twisters/`) gains `stored: {limit, used, remaining}`.
- `manage.py prune_generation_usage` (workflow allow-list, cron `19 5 * * *`) deletes `GenerationUsage` rows older than `GENERATE_USAGE_RETENTION_DAYS` (90); output `pruned=N`. Only today's row affects the quota.

### Reminders and the timezone flag

- New `Profile.timezone_confirmed` (boolean, default false; migration `0018_round4_timezone_confirmed`, which sets it true for existing rows whose zone is not `UTC`, so nobody loses or gains anything at deploy). `PATCH /me/` with a `timezone` sets it, including for `UTC`. `GET /me/` and `GET /me/reminders/` return it (read-only in `PATCH /me/`); the export profile section lists it.
- `send_reminders` and the hour-of-day badges now test this flag instead of comparing the zone to the literal `UTC`, so a genuine UTC user who confirmed the zone is mailed. The web client reports the browser zone with `PATCH /me/`; an account that never did stays unconfirmed and unmailed.

### Export size guard

`GET /me/export/` is limited by `EXPORT_MAX_ATTEMPTS` (now documented as an env setting, default 20000) **and** `EXPORT_MAX_BYTES` (new, default 4,000,000): Vercel Functions reject response bodies over 4.5 MB. `attempts` is written after every other section and takes the remaining byte budget, newest first; when a row would not fit the array is closed and `truncated: true`. `truncated` is now the last key of the document (it is only known at the end); JSON consumers are unaffected. `schema_version` stays 1.

## 14. Speech engine endpoints as built (A1-A5)

* `GET /engine/manifest/` — `{model|null, scoring_profile|null, lexicon_version, score_version}`; `null` model while `accurate_mode` is off or none is published.
* `GET /twisters/{slug}/pronunciations/?lang=en-US|en-GB|en-IN|en-AU` — the twister's words with every accepted pronunciation, accent rules applied (what the browser engine scores against).
* `POST /attempts/` — device fields `engine:"ondevice"`, `engine_version`, `model_version`, `scoring_profile`, `nonce`, `audio_sha256`, `quality` (≤ 12 scalar keys), `words[{i,target,status,reason?,start_ms,end_ms,phonemes[{t,verdict,heard?,delta,lpp,lpr,start_ms,end_ms}]}]`. `422 model_unsupported` tells the client to resend as basic scoring. The response may carry `spot_check:{requested, expires_at}`.
* Spot-check clip: `POST /voice/ {purpose:"spot_check", attempt:<numeric id>, …}` → `{voice_asset_id (UUID), status, expires_at, upload, quota}` → tus upload → `POST /voice/{uuid}/complete/ {checksum_sha256}` → `POST /attempts/{id}/spot-check-audio/ {voice_asset_id}` (202 job summary; 409 `no_request`/`expired`/`model_retired`).
* `GET /recordings/{id}/` — `analysis` is now `{status, audio_ready, scoring:{status, reason}}` (doc 13 §14).
* Internal (HMAC): `POST /internal/scoring-jobs/claim/`, `…/{id}/heartbeat/`, `…/{id}/result/`. `kind` is `spot_check` or `record`; a `record` result carries full `words[]` with phonemes and `duration_ms`, a `spot_check` result carries `{i,status,reason}` only.
* Errors with a stable `code`: `model_unsupported` (422), `no_request` / `expired` / `model_retired` (409), `lease_lost` (409), `nonce_invalid`, `audio_hash_duplicate` (409), `quota_exceeded` (402, `details.limit`).
