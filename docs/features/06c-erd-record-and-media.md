# 06c — ERD: Record mode, media, sharing & consent
PRD: `04-prd-record-mode.md` · Master model: `06` · Decisions: `11` (D1, D2, D6, D7, D14)

```mermaid
erDiagram
    PROFILE ||--o{ RECORDING : owns
    PROFILE ||--o{ MEDIA_ASSET : owns
    PROFILE ||--o{ USER_CONSENT : grants
    PROFILE ||--o{ SHARE_LINK : creates
    PROFILE }o--|| PLAN : "limits from"
    TWISTER ||--o{ RECORDING : "recorded for"
    PRACTICE_SESSION ||--o{ RECORDING : produces
    ATTEMPT ||--o| RECORDING : "analysed take"
    RECORDING ||--|| MEDIA_ASSET : video
    RECORDING ||--o| MEDIA_ASSET : thumbnail
    RECORDING ||--o| MEDIA_ASSET : captions
    RECORDING ||--o{ SHARE_LINK : "shared via"
    SHARE_LINK ||--o{ MODERATION_REPORT : "reported as"
    PROFILE ||--o{ MODERATION_REPORT : files
    PROFILE ||--o{ STORAGE_LEDGER : "quota usage"

    RECORDING {
        uuid id PK
        uuid profile_id FK
        uuid client_recording_id "UK with profile_id"
        bigint twister_id FK
        uuid session_id FK
        bigint attempt_id FK
        varchar title
        varchar layout "camera text side_by_side screen_bubble pip portrait region"
        jsonb layout_settings "bubble corner, split ratio, bg, text scale"
        jsonb crop_rect "post-capture crop x y w h"
        int trim_start_ms
        int trim_end_ms
        boolean has_camera
        boolean has_screen
        boolean has_mic
        boolean has_system_audio
        int duration_ms
        int width
        int height
        smallint fps
        varchar mime_type
        bigint size_bytes
        varchar capture_source "getUserMedia getDisplayMedia region_capture element_capture"
        varchar status "recording local_ready uploading uploaded processing ready failed deleted"
        varchar failure_reason
        boolean recovered "rebuilt from IndexedDB chunks"
        uuid video_asset_id FK
        uuid thumbnail_asset_id FK
        uuid captions_asset_id FK
        varchar captions_source "none alignment"
        varchar visibility "private unlisted"
        varchar ended_reason "user limit device error tab_hidden"
        timestamptz consented_at
        timestamptz expires_at
        timestamptz deleted_at
        timestamptz created_at
    }
    MEDIA_ASSET {
        uuid id PK
        uuid profile_id FK
        varchar kind "audio video image caption"
        varchar bucket
        varchar path "UK with bucket"
        varchar mime_type
        bigint size_bytes
        int duration_ms
        int width
        int height
        char checksum_sha256
        varchar status "pending_upload uploading uploaded processing ready failed deleted"
        varchar upload_id "TUS id"
        int upload_attempts
        timestamptz expires_at
        timestamptz created_at
        timestamptz deleted_at
    }
    SHARE_LINK {
        uuid id PK
        varchar target_type "recording score_card"
        uuid target_id "recording.id or attempt.public_id"
        char token_hash UK
        uuid created_by FK
        timestamptz expires_at
        timestamptz revoked_at
        int view_count
        timestamptz last_viewed_at
        timestamptz created_at
    }
    USER_CONSENT {
        bigint id PK
        uuid profile_id FK
        varchar type "recording_upload voice_storage voice_processing model_improvement terms marketing"
        varchar version
        timestamptz granted_at
        timestamptz revoked_at
        char ip_hash
    }
    MODERATION_REPORT {
        bigint id PK
        uuid reporter_id FK
        uuid share_link_id FK
        varchar reason
        text details
        varchar status "open actioned dismissed"
        uuid resolved_by FK
        timestamptz created_at
        timestamptz resolved_at
    }
    STORAGE_LEDGER {
        bigint id PK
        uuid profile_id FK
        varchar kind "recording voice thumb caption"
        uuid asset_id FK
        bigint delta_bytes "positive reserve, negative release"
        varchar reason "reserve complete delete expire"
        timestamptz created_at
    }
    PLAN {
        varchar code PK
        jsonb limits
    }
    PROFILE {
        uuid id PK
        varchar plan_code FK
        varchar age_band
    }
    TWISTER {
        bigint id PK
    }
    PRACTICE_SESSION {
        uuid id PK
    }
    ATTEMPT {
        bigint id PK
        uuid public_id UK
    }
```

## Traceability
| Req | Data support |
|---|---|
| V1–V4 layouts | `Recording.layout` + `layout_settings` JSON (bubble corner, split ratio, text scale, background) — no schema change per new layout |
| V5 review page (markers) | Mistake markers derived from `AttemptWord.start_ms/end_ms` via `Recording.attempt_id`; no marker table |
| V6 download | Local only; no rows until the user saves to cloud |
| V7 chunk recovery | Client IndexedDB; on recovery the saved row gets `recovered=true` |
| V8/V9 screen / region capture | `has_screen`, `capture_source`; `crop_rect` for post-capture crop (PRD 04 §3) |
| V10 cloud save + quota | `Plan.limits`, `StorageLedger` (append-only, sum = usage), `MediaAsset` state machine, `UserConsent(recording_upload)` |
| V11 share links | `ShareLink` (hashed token, expiry, revoke, view count) |
| V12 transcode/thumbnail | `MediaAsset(kind=image/video)` derived rows; `Recording.status=processing` |
| V13 trim | `trim_start_ms/trim_end_ms` (non-destructive; applied at playback/export) |
| V14 moderation | `ModerationReport` |
| Captions | `captions_asset_id`, `captions_source='alignment'`: the target text timed by the engine's alignment (no transcription needed) |

## Fixes vs the first ERD
1. **`ShareLink.target_id` type mismatch.** `Attempt.id` is bigint but `target_id` was uuid → score cards now reference `Attempt.public_id` (uuid). Recordings use `Recording.id`.
2. **Quota accounting.** Summing `MediaAsset.size_bytes` at request time is slow and racy; the **append-only `StorageLedger`** gives atomic reserve/release (`SELECT ... FOR UPDATE` on a per-user advisory lock) and an audit trail.
3. **Idempotent creation.** `client_recording_id` prevents duplicate rows when the upload retries.

## Constraints & indexes
- `Recording`: `UNIQUE(profile_id, client_recording_id)`; idx `(profile_id, created_at DESC) WHERE deleted_at IS NULL`, `(expires_at) WHERE deleted_at IS NULL`; CHECK `trim_end_ms IS NULL OR trim_end_ms > trim_start_ms`; CHECK `duration_ms <= 600000`; plan-specific max enforced in service.
- `MediaAsset`: `UNIQUE(bucket, path)`; CHECK `size_bytes <= 100 MB`; idx `(status, created_at)`.
- `ShareLink`: `UNIQUE(token_hash)`; idx `(target_type, target_id)`; a link resolves only if `revoked_at IS NULL AND expires_at > now()` and the target is not deleted.
- `StorageLedger`: idx `(profile_id, created_at)`; usage = `SUM(delta_bytes)`; nightly compaction into a balance row.
- `UserConsent`: latest active consent per `(profile_id, type)` where `revoked_at IS NULL`.

## Behaviour rules
| Rule | Detail |
|---|---|
| Consent gate | No cloud reserve without `recording_upload` consent (current `version`); uploading voice for the worker needs `voice_processing` consent; donating audio for model improvement needs `model_improvement`; under-13 (`age_band`) blocked (D6) |
| Quota (D1) | Reserve on `POST /recordings/` (ledger `+size_estimate`), reconcile on `complete` (actual), release on delete/expire |
| Retention | `expires_at = created_at + plan.retention_days`; `expire_recordings` job soft-deletes then hard-deletes after 24 h; reminder at T-3 d |
| Share access | Playback via short-lived (≤ 1 h) signed URLs minted after token validation; never bucket-public; `noindex` |
| Account deletion (D14) | Soft-delete recordings/assets immediately; purge objects ≤ 24 h; revoke all `ShareLink`s |
| Gallery (D2) | No public listing endpoint; no `visibility='public'` value exists |

## Migrations
M4 (before P3/P4): `Recording`, `MediaAsset`, `StorageLedger`, `ShareLink`, `ModerationReport`, `UserConsent`. Storage buckets + RLS policies per `06` §5. Requires Supabase **Pro** in production (D7).
