# 06d — ERD: Progress, gamification, discovery & notifications
PRD: `05-prd-progress-and-gamification.md` · Master model: `06` · Decisions: `11` (D4, D5, D11, D13, D14, D16–D19)

> **Built (core slice):** `Achievement`, `UserAchievement`, `DailyTwister`, `LeaderboardEntry`, `Profile.streak_freezes/hide_from_boards` — see `14-06d-build-spec.md`. **Not built yet:** `NotificationChannel`, `TwisterGeneration`; the `UserTwisterStats` columns `total_active_ms`, `read_along_ms`, `is_favorite` were dropped on purpose (derivable from `DailyActivity` / `Favorite`).

```mermaid
erDiagram
    PROFILE ||--o{ USER_TWISTER_STATS : accumulates
    PROFILE ||--o{ DAILY_ACTIVITY : logs
    PROFILE ||--o{ USER_ACHIEVEMENT : unlocks
    PROFILE ||--o{ FAVORITE : saves
    PROFILE ||--o{ NOTIFICATION_CHANNEL : "opts into"
    PROFILE ||--o{ TWISTER_GENERATION : requests
    PROFILE ||--o{ LEADERBOARD_ENTRY : ranks
    ACHIEVEMENT ||--o{ USER_ACHIEVEMENT : awarded
    TWISTER ||--o{ USER_TWISTER_STATS : "stats for"
    TWISTER ||--o{ FAVORITE : "favorited in"
    TWISTER ||--o| DAILY_TWISTER : "featured as"
    TWISTER ||--o{ LEADERBOARD_ENTRY : "ranked on"
    TWISTER ||--o| TWISTER_GENERATION : "created by"
    ATTEMPT ||--o| LEADERBOARD_ENTRY : "best attempt"
    DAILY_TWISTER ||--o{ LEADERBOARD_ENTRY : "weekly board"

    USER_TWISTER_STATS {
        bigint id PK
        uuid profile_id FK
        bigint twister_id FK
        int attempts_count
        int test_attempts_count
        smallint best_score "verified test"
        smallint best_practice_score "provisional"
        smallint last_score
        timestamptz first_attempt_at
        timestamptz last_attempt_at
        timestamptz mastered_at
        int mastery_days_hit "distinct days at or above 90"
        date mastery_last_day
        int total_active_ms
        int read_along_ms
        boolean is_favorite
    }
    DAILY_ACTIVITY {
        bigint id PK
        uuid profile_id FK
        date local_date
        smallint attempts
        int active_ms
        int read_along_ms
        int xp
        boolean qualifies_streak
        boolean freeze_used
    }
    ACHIEVEMENT {
        varchar code PK
        varchar name
        varchar description
        varchar icon
        varchar tier "bronze silver gold"
        varchar category
        jsonb criteria
        smallint xp_reward
        boolean verified_only
        boolean hidden
        boolean active
    }
    USER_ACHIEVEMENT {
        bigint id PK
        uuid profile_id FK
        varchar achievement_code FK
        timestamptz unlocked_at
        real progress "0..1"
        boolean revoked
        boolean seen
    }
    FAVORITE {
        bigint id PK
        uuid profile_id FK
        bigint twister_id FK
        timestamptz created_at
    }
    DAILY_TWISTER {
        date day PK
        bigint twister_id FK
        varchar source "editorial auto"
        timestamptz locked_at
    }
    LEADERBOARD_ENTRY {
        bigint id PK
        date week_start "Monday UTC"
        bigint twister_id FK
        uuid profile_id FK
        smallint best_score
        bigint best_attempt_id FK
        timestamptz achieved_at
        int rank "materialised hourly"
    }
    NOTIFICATION_CHANNEL {
        bigint id PK
        uuid profile_id FK
        varchar type "email webpush"
        jsonb endpoint "address or push subscription"
        boolean enabled
        time local_time "reminder time"
        varchar timezone
        varchar kinds "streak_reminder recording_expiry weekly_digest"
        timestamptz last_sent_at
        char unsubscribe_token_hash UK
        timestamptz created_at
    }
    TWISTER_GENERATION {
        bigint id PK
        uuid profile_id FK
        bigint twister_id FK
        jsonb params "theme sound difficulty length"
        varchar model
        varchar moderation_result "approved rejected needs_review"
        int tokens_in
        int tokens_out
        timestamptz created_at
    }
    PROFILE {
        uuid id PK
        int xp
        int current_streak
        int best_streak
        int streak_freezes
        date last_activity_date
        boolean hide_from_boards
        varchar display_name
    }
    TWISTER {
        bigint id PK
        varchar source "seed user ai"
        varchar visibility "public private"
        varchar moderation_status
    }
    ATTEMPT {
        bigint id PK
    }
```

## Traceability
| Req | Data support |
|---|---|
| G1 home strip (mastered / streak / achievements) | `Profile.current_streak`, count of `UserTwisterStats.mastered_at IS NOT NULL`, count of `UserAchievement` |
| G2 mastery filter on Browse | `UserTwisterStats.mastered_at`; API adds `?mastery=mastered|learning|new` |
| G3 streak engine | `DailyActivity.qualifies_streak` per local date; `Profile.current_streak` is a cache; freezes: `Profile.streak_freezes` + `DailyActivity.freeze_used` |
| G4 achievements | `Achievement` catalogue (24, seeded from code) + `UserAchievement` (idempotent unlock) |
| G5 stats page | Aggregates over `DailyActivity` (activity, minutes), `Attempt` (avg score), `UserWordStat`/`UserPhonemeStat` (weak words/sounds, 06b) |
| G6 favourites / random | `Favorite`, `UserTwisterStats.is_favorite`; random = `ORDER BY random()` on a filtered id list (cached) |
| G7 facet counts + sort | Query-time on `Twister` + `Category`; no table |
| G8 score-card share | `ShareLink(target_type=score_card, target_id=Attempt.public_id)` (06c) |
| G9 Generate Twister | `TwisterGeneration` (params, model, moderation, tokens) + new `Twister(source='ai', visibility='private', moderation_status)` |
| G10 reminders | `NotificationChannel` (one-tap unsubscribe via `unsubscribe_token_hash`) |
| Daily twister (PRD 05 §2) | `DailyTwister` (editorial override else deterministic hash pick, locked at 00:00 UTC) |
| Leaderboards (D13) | `LeaderboardEntry` rebuilt hourly from verified Test attempts; opt-out via `Profile.hide_from_boards` |

## Rules (single source of truth in code; constants in config)
- **Level:** `1 + xp // 200` (function, replaceable by `200·level^1.15` later).
- **Streak day qualifies** if any: scored attempt (any kind) **or** Read-along pass ≥ 1 with ≥ 30 s active (D4). Freeze auto-consumed for one missed day (max 2 banked, earned every 7-day streak).
- **Mastery:** per D5 — verified Test ≥ 90 on `MASTERY_DAYS=2` distinct local dates inside `MASTERY_WINDOW_DAYS=30`; maintain `mastery_days_hit` + `mastery_last_day`; `mastered_at` immutable once set.
- **XP diminishing returns:** > 100 XP per twister per day earns 25 %; Read-along cap 50 XP/day.
- **Achievement evaluation** runs after the attempt transaction commits, from a small ruleset keyed by event type; unlocks are idempotent (`UNIQUE(profile_id, achievement_code)`).
- **AI-generated twisters** start `visibility='private'`; publishing publicly is not offered in v1 (D2). Prompts pass a safety filter; results pass a blocklist + length/word-count checks before save.

## Constraints & indexes
- `UserTwisterStats`: `UNIQUE(profile_id, twister_id)`; idx `(profile_id, mastered_at)`.
- `DailyActivity`: `UNIQUE(profile_id, local_date)`.
- `UserAchievement`: `UNIQUE(profile_id, achievement_code)`.
- `Favorite`: `UNIQUE(profile_id, twister_id)`.
- `DailyTwister`: PK `day`.
- `LeaderboardEntry`: `UNIQUE(week_start, twister_id, profile_id)`; idx `(week_start, twister_id, rank)`.
- `NotificationChannel`: `UNIQUE(unsubscribe_token_hash)`; idx `(enabled, local_time)`.
- `TwisterGeneration`: idx `(profile_id, created_at)`; rate limit 10/day free (config).

## Edge cases → data rules
| Case | Rule |
|---|---|
| Timezone travel | `local_date` derived from the tz sent with the attempt (validated IANA) and stored; the streak never breaks retroactively |
| Client clock skew / backdating | Server rejects `client_time` more than 5 min off from server time for scoring; `local_date` uses server time + profile tz |
| Score v1 → v2 change | Best scores compared within version; stats keep `best_score` (v2) and legacy field until backfill |
| Deleted account on leaderboard | Rows deleted (or anonymised if the user chose to keep results), then ranks recomputed |
| Achievement criteria change | Bump criteria version; never auto-revoke unlocked achievements (`revoked` only by admin) |
| Reminders vs. DND | Send within a user-chosen local hour ±30 min, max 1/day, skip if already practised today |

## Migrations
M1: `DailyActivity`, `UserTwisterStats`, `Achievement`, `UserAchievement`. M2: backfills (stats and streaks from history). M5 (P3–P5): `DailyTwister`, `NotificationChannel`, `TwisterGeneration`, `LeaderboardEntry`.
