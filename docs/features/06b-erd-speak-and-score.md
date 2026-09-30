# 06b — ERD: Speak & Score (attempts, words, phonemes, engine jobs)
PRD: `03-prd-speak-and-score-mode.md` · Pipeline: `10` · Decisions: `11` (D3, D5, D8–D10)

```mermaid
erDiagram
    PROFILE ||--o{ ATTEMPT : makes
    PROFILE ||--o{ USER_WORD_STAT : "weak words"
    PROFILE ||--o{ USER_PHONEME_STAT : "weak sounds"
    TWISTER ||--o{ ATTEMPT : "attempted in"
    TWISTER ||--o{ TWISTER_PRONUNCIATION : "pronunciation overrides"
    PRACTICE_SESSION ||--o{ ATTEMPT : contains
    ATTEMPT ||--o{ ATTEMPT_WORD : "word results"
    ATTEMPT_WORD ||--o{ ATTEMPT_PHONEME : "phoneme results"
    ATTEMPT ||--o| MEDIA_ASSET : "voice audio"
    ATTEMPT ||--o{ SCORING_JOB : "worker jobs"
    SCORING_JOB }o--|| ACOUSTIC_MODEL_VERSION : uses
    ATTEMPT }o--o| SCORING_PROFILE : "scored with"
    ACOUSTIC_MODEL_VERSION ||--o{ SCORING_PROFILE : "calibrated for"
    ATTEMPT_WORD ||--o{ ATTEMPT_FEEDBACK : "rated by user"

    TWISTER {
        bigint id PK
        jsonb focus_sounds "e.g. S SH pair"
        jsonb phonemes "ARPAbet per word, built offline"
        smallint phoneme_version
    }
    TWISTER_PRONUNCIATION {
        bigint id PK
        bigint twister_id FK
        varchar word "normalised"
        varchar arpabet "space separated"
        varchar ipa
        varchar respelling "PEK-uhld"
        jsonb accepted_variants "spoken forms counted correct"
        varchar accent "null = all, or en-IN en-GB en-US en-AU"
        varchar source "cmudict rule override g2p"
        varchar note
    }
    ATTEMPT {
        bigint id PK
        uuid public_id UK "for score-card sharing"
        uuid profile_id FK
        bigint twister_id FK
        uuid session_id FK
        uuid client_attempt_id "UK with profile_id"
        varchar kind "test train drill record"
        text transcript
        real accuracy
        real speed_score
        real fluency_score
        real gop_score "acoustic score from our engine, nullable"
        real completeness "share of expected words found"
        smallint score
        smallint score_version "1 legacy 2 current"
        real wpm
        int duration_ms
        int long_pause_ms
        real engine_confidence
        varchar engine "text_layer ondevice worker"
        varchar engine_version
        bigint model_version_id FK
        bigint scoring_profile_id FK
        uuid nonce "per-attempt anti-replay"
        char audio_sha256
        jsonb quality "snr clipping blank_ratio"
        boolean spot_checked
        real spot_check_delta
        varchar lang
        varchar verification_status "none device pending verified failed"
        timestamptz verified_at
        boolean is_personal_best
        boolean flagged
        smallint xp_awarded
        jsonb breakdown "aggregate for train and drill"
        uuid voice_asset_id FK
        timestamptz created_at
    }
    ATTEMPT_WORD {
        bigint id PK
        bigint attempt_id FK
        smallint target_index "null for extras"
        smallint spoken_index "null for missed"
        varchar target_word
        varchar spoken_word
        varchar status "correct near wrong missed extra"
        varchar reason "homophone focus_swap slurred uncertain low_conf"
        real credit
        real confidence
        real acoustic_score "0..100 from GOP features, nullable"
        real phoneme_distance
        int start_ms
        int end_ms
    }
    ATTEMPT_PHONEME {
        bigint id PK
        bigint attempt_word_id FK
        smallint idx
        varchar target_phoneme
        varchar heard_phoneme "null if deleted"
        varchar variant_used "which pronunciation variant matched"
        varchar verdict "ok weak substituted deleted uncertain"
        real delta "substitution test, log-likelihood ratio"
        real lpp "mean log posterior of target"
        real lpr "log posterior ratio vs best competitor"
        int start_ms
        int end_ms
    }
    USER_WORD_STAT {
        bigint id PK
        uuid profile_id FK
        varchar word_norm
        int seen
        int correct
        int near
        int wrong
        int missed
        real weakness "0..1 recency-weighted"
        timestamptz last_seen_at
        timestamptz next_review_at "spaced repetition"
        smallint streak_correct
    }
    USER_PHONEME_STAT {
        bigint id PK
        uuid profile_id FK
        varchar phoneme_pair "S>SH"
        int occurrences
        int errors
        real error_rate
        timestamptz updated_at
    }
    PRACTICE_SESSION {
        uuid id PK
    }
    MEDIA_ASSET {
        uuid id PK
    }
    PROFILE {
        uuid id PK
    }
    SCORING_JOB {
        uuid id PK
        bigint attempt_id FK
        uuid audio_asset_id FK
        varchar kind "spot_check verify device_unsupported"
        varchar status "queued running done failed expired"
        smallint tries
        int latency_ms
        varchar error_code
        bigint model_version_id FK
        timestamptz created_at
        timestamptz started_at
        timestamptz finished_at
    }
    ACOUSTIC_MODEL_VERSION {
        bigint id PK
        varchar name "w2v-espeak-lv60-int8-r1"
        varchar base_model "facebook/wav2vec2-lv-60-espeak-cv-ft"
        varchar licence
        varchar quantization "fp32 fp16 int8"
        bigint size_bytes
        char sha256
        varchar label_map_version
        boolean active
        timestamptz released_at
    }
    SCORING_PROFILE {
        bigint id PK
        varchar code UK "sp-2026-10-a"
        bigint model_version_id FK
        jsonb thresholds "per phoneme class and accent pack"
        jsonb accent_packs "rules with penalties"
        jsonb confusion_map
        varchar calibration_set
        boolean active
        timestamptz created_at
    }
    ATTEMPT_FEEDBACK {
        bigint id PK
        bigint attempt_word_id FK
        uuid profile_id FK
        boolean judged_correct "user says the verdict was right"
        varchar comment
        boolean donated_audio
        timestamptz created_at
    }
```

## Traceability
| Req | Data support |
|---|---|
| S1 pre-flight | Client-only; `speak_preflight` analytics event |
| S3 alignment & statuses | `AttemptWord.status/reason/phoneme_distance`; algorithm in `10` §4 |
| S4 mistakes view | `AttemptWord` joined to `Attempt`; "what we heard" = `Attempt.transcript` + `spoken_word` |
| S5 Test vs Train | `Attempt.kind`; Train/Drill store only `breakdown` JSON (no `AttemptWord` rows) |
| S6 word drill | `UserWordStat` (weakness, `next_review_at`) drives the "practise weak words" queue |
| S7 own-voice playback | `Attempt.voice_asset_id → MediaAsset(kind=audio)`; default local-only (no row) |
| S8 history | `Attempt` + `AttemptWord` (Test/Record only) |
| S9 scoring v2 | `score_version=2`, `speed_score`, `fluency_score`, `engine_confidence`, `engine`, `verification_status` |
| S11 device / worker scoring | `verification_status`, `gop_score`, `AttemptPhoneme`, `ScoringJob`, `AcousticModelVersion`, `ScoringProfile` |
| S12 offline queue | `client_attempt_id` idempotency; `SyncBatch` (06a) |
| S13 anti-cheat / rate limit | `flagged`, `nonce`, `audio_sha256`, `spot_checked`, `spot_check_delta` |
| Feedback loop / calibration | `AttemptFeedback`, `UserConsent(model_improvement)` |
| Practice by word, sound insights (reference app) | `UserWordStat`, `UserPhonemeStat` |

## Write rules (volume control)
- **Test/Record** attempts: write `AttemptWord`; write `AttemptPhoneme` **only when scored by the device/worker engine** — ~3–4× words per twister.
- **Train/Drill**: `breakdown` JSON `{correct,near,wrong,missed,extra,words:[[idx,status]]}`, no child rows.
- `UserWordStat` and `UserPhonemeStat` are updated **in the same transaction** as the attempt (upsert), reconciled nightly from `AttemptWord`.
- `UserWordStat.weakness = 0.6·recent_error_rate + 0.4·lifetime_error_rate`; `next_review_at` follows a simple ladder (1 d, 3 d, 7 d, 14 d) reset on error.

## Constraints & indexes
- `Attempt`: `UNIQUE(profile_id, client_attempt_id)`, `UNIQUE(public_id)`; idx `(profile_id, twister_id, created_at DESC)`, `(twister_id, score DESC) WHERE verification_status='verified' AND NOT flagged AND kind='test'` (leaderboard), `(verification_status, created_at) WHERE verification_status='pending'` (retry sweeper).
- `AttemptWord`: idx `(attempt_id)`; CHECK `status IN ('correct','near','wrong','missed','extra')`.
- `AttemptPhoneme`: idx `(attempt_word_id)`; partial idx `(target_phoneme, spoken_phoneme) WHERE op='sub'`.
- `UserWordStat`: `UNIQUE(profile_id, word_norm)`; idx `(profile_id, weakness DESC)`, `(profile_id, next_review_at)`.
- `UserPhonemeStat`: `UNIQUE(profile_id, phoneme_pair)`.
- `TwisterPronunciation`: `UNIQUE(twister_id, word)`; global overrides allowed with `twister_id NULL`.
- `ScoringJob`: idx `(status, created_at)`, `(attempt_id)`; `ScoringProfile`: `UNIQUE(code)`, one active per model version; `AcousticModelVersion`: `UNIQUE(sha256)`; `AttemptFeedback`: idx `(attempt_word_id)`.

## Behaviour rules
| Rule | Detail |
|---|---|
| Trust (D8) | mastery, boards and verified-only achievements need `verified`, or `device` from a user whose spot-checks pass |
| Pending retry | `pending` older than 10 min ⇒ sweeper retries once, then `failed` (the device result stands) |
| Spot-check (D8) | ~10 % of `device` Test attempts and every would-be personal best ≥ 90 create a `ScoringJob(kind=spot_check)`; disagreement above threshold sets `flagged`; repeated disagreement disables device results for that user |
| Personal best | Computed on `verified` Test attempts only; provisional bests shown with "practice" chip |
| Version bump | Best score compared within the same `score_version`; legacy v1 shown with a badge |
| Deleting an attempt | Cascades `AttemptWord/Phoneme/Feedback`, `ScoringJob` rows, storage object removed |

## Migrations
M1: new columns on `Attempt`, `Twister.phonemes/phoneme_version`; tables `AttemptWord`, `TwisterPronunciation`. M2: backfill `kind='test'`, `score_version=1`, `verification_status='none'`, `public_id=gen_random_uuid()`. M3: `AttemptPhoneme`, `UserWordStat`, `UserPhonemeStat`, `AcousticModelVersion`, `ScoringProfile`, `ScoringJob`, `AttemptFeedback` (ahead of P2b). Build `Twister.phonemes` with a management command `build_pronunciations` (CMUdict + `TwisterPronunciation` overrides) and fail CI if any word in the seed has no pronunciation.
