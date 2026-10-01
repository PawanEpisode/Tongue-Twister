# 11 — Decisions Log (resolves `00` §8 open questions)

Format: lightweight ADRs. Every numeric value below lives in **config** (`settings.py` / `Plan.limits`), not code, so it can be tuned without a migration. Status **Accepted** unless noted. Date: 2026-09-30.

| ID | Topic | Decision (one line) |
|---|---|---|
| D1 | Cloud recording limits | Free: 5 recordings · 3 min · 100 MB total · 30-day retention from creation |
| D2 | Public gallery | **No** in v1; private + unlisted share links only |
| D3 | Speech engine | **Build in-house**: open-source phoneme model + our own alignment/GOP scoring; no paid or third-party speech APIs (design in `10`) |
| D4 | Read-along and streaks/XP | Counts toward streak (≥ 1 full pass **and** ≥ 30 s active); XP 25 % of a scored attempt, cap 50/day |
| D5 | Mastery | ≥ 90 on **verified** Test attempts on 2 different local days within 30 days — confirmed |
| D6 | Minimum age | 13+; under-13 blocked from cloud recording, voice uploads and audio donation |
| D7 | Storage plan | Move Supabase to **Pro before enabling cloud recordings (P4)**; free tier only for dev/staging |
| D8 | Trust levels | `provisional` (text layer) / `device` (on-device engine) / `verified` (worker re-score); spot-checks keep device results honest |
| D9 | Abuse & capacity controls | Rate limits, nonces, audio-hash dedupe, worker queue caps; no vendor spend to budget |
| D10 | Phonetic strictness | Focus-sound swaps are `wrong` (substitution test), accent packs never override a twister's protected contrast, abstain rather than accuse |
| D11 | Plans | Ship a `Plan` table with only `free`; no billing until demand is proven |
| D12 | Guest data | Guests practise locally (IndexedDB); one-time idempotent sync on sign-up |
| D13 | Leaderboards | Weekly, verified-only, opt-out, materialised table; P5 |
| D15 | Hosting stance | Never depend on a free host: device engine is serverless; worker is a portable container |
| D14 | Delete & export | Account deletion purges media in ≤ 24 h, anonymises stats in ≤ 30 d; JSON export before deletion |
| D16 | Streak freezes | One freeze banked per 7-day streak multiple (max 2), auto-consumed to bridge one missed local day |
| D17 | Recordings and streaks | A saved recording does not count toward the streak; it only feeds `recorded_1` |
| D18 | Board names | `public_name` or stable `Player NNNN`; opted-out and under-13 excluded; under-13 viewers get 403 |
| D19 | Achievement evaluation | In-request, in a savepoint under the Profile lock; state-based; never auto-revoked; 25 achievements |

---

## D1 — Cloud recording limits
**Context.** Video dominates storage cost (~15 MB/min at 2 Mbps). Loom Free-style caps (short length, small count) are the industry norm for free tiers; Supabase Free caps files at 50 MB.
**Decision.** Free plan: **5 stored recordings, 3 min each, 100 MB total, 30 days from creation** (not "from last view" — simpler to explain, cheaper, and predictable). Reminder email at T-3 days. Downloading to the device is always free and unlimited. Server enforces at `POST /recordings/` (reserve) and `complete`.
**Consequences.** `Plan.limits` JSON: `{recordings_max:5, recording_ms_max:180000, storage_bytes_max:104857600, retention_days:30, share_max_days:7}`. A future Pro plan (e.g. 50 / 10 min / 2 GB / 1 year) needs no schema change.
**Revisit when.** Storage cost > 20 % of infra spend or > 30 % of users hit the cap.

## D2 — No public gallery
**Decision.** No community feed. Sharing = unlisted `ShareLink` (128-bit token, hashed at rest, expiry, revoke, `noindex`).
**Why.** Public video from a minor-friendly product requires moderation staffing and legal exposure; not worth it before product-market fit.
**Consequence.** `ModerationReport` still ships (users can report a link they received). Revisit after 10 k MAU.

## D3 — Speech engine: build in-house (see `10`)
**Decision.** No paid or third-party speech services. Components: open-source phoneme CTC model (Apache-2.0), CMUdict lexicon + our rules, our own alignment, substitution tests, GOP features, verdicts, fusion and scoring. Optional browser Web Speech text layer (off in private mode). Tiers: 0 = lexicon + text layer (now); 1 = on-device engine (opt-in "Accurate mode"); 2 = optional worker for spot-checks; 3 = own small model (R&D).
**Why.** Full control of strictness (focus swaps), privacy (audio can stay on the device), zero per-attempt cost, no vendor lock-in or key management.
**Consequences.** Real engineering scope (phases E3-1…E3-6 in `10` §11); we must collect our own calibration data; model download/export is a one-time step on your machine because Hugging Face is not reachable from the build sandbox.
**Acceptance to enable Accurate mode (`10` §7):** focus-swap recall ≥ 85 %, false accusation on clean reads ≤ 5 %, accent gap ≤ 8 pts, median latency ≤ 3 s on a mid-range laptop.

## D4 — Read-along counts toward streak/XP
**Decision.** A day qualifies for the streak with **either** one scored attempt (any kind) **or** one completed Read-along pass with ≥ 30 s active time. XP = 25 % of the scored-attempt base, max 50 XP/day from Read-along. Read-along never produces a score, mastery or leaderboard entry.
**Why.** Keeps low-pressure practice inside the habit loop (industry pattern: Duolingo counts any lesson) while the daily cap prevents farming.

## D5 — Mastery (confirmed)
**Decision.** `mastered_at` set when ≥ 90 on a **verified** Test attempt occurs on 2 distinct local dates within 30 days. Never cleared. Constants: `MASTERY_MIN_SCORE=90`, `MASTERY_DAYS=2`, `MASTERY_WINDOW_DAYS=30`.
**Note.** Until P2b ships verification, provisional attempts with engine confidence ≥ 0.6 may count so mastery is not blocked; backfill re-evaluates once verification exists.

## D6 — Minimum age 13+
**Decision.** Terms require 13+. `age_band` self-declared at first sign-in; `under13` accounts cannot save recordings to cloud, upload voice for the worker, or donate audio (local practice only) and see no leaderboards. Shared score cards contain no face/video.
**Why.** COPPA/GDPR-K exposure; avoids parental-consent flow in v1.

## D7 — Move Supabase to Pro before P4
**Decision.** Free tier for development/staging. Production with cloud recordings requires Supabase **Pro** (larger per-file limit than Free's 50 MB, higher storage/egress quotas, daily backups — **verify current numbers**). Text-only features (P0–P2) can stay on Free until traffic requires otherwise.

## D8 — Trust levels
`Attempt.verification_status ∈ none | device | pending | verified | failed`. `none` = text-layer only (practice score). `device` = scored by the on-device engine. `verified` = re-scored by the worker. Mastery, weekly boards and verified-only achievements need `verified`, **or** `device` from a user whose spot-checks pass (random ~10 % of Test attempts and every would-be personal best ≥ 90 are re-scored with consent). Repeated disagreement ⇒ that user's device results stop counting.

## D9 — Abuse and capacity controls
Per-attempt nonce tied to the twister version; audio-hash dedupe; rate limit 10 requests/min/user; worker queue cap with back-pressure (device result stands, spot-check retried later); no vendor spend exists to cap.

## D10 — Phonetic strictness
A `focus_sounds` phoneme that is substituted or dropped (CTC substitution test) makes the word `wrong` (reason `focus_swap`) and caps the attempt at 79. Accent packs add accepted variants but are **disabled for any contrast the twister trains** (protected contrasts). When evidence is inside the abstention band the word is `uncertain` and never counts against the score (a false accusation costs more than a missed slip). `TwisterPronunciation` overrides win over the dictionary; a twister cannot be published with an unknown word.

## D11 — Plans without billing
Create `Plan(code PK, limits jsonb)` with `free` only; `Profile.plan_code` defaults `free`. Introduce Stripe only when a paid tier is justified by cap-hit data.

## D12 — Guest experience
Guests get Read-along, Speak (provisional, local), and local recording download. History lives in IndexedDB. On sign-up the client posts one `POST /sync/guest/` batch (attempts, favourites, preferences) with client-generated UUIDs; server ignores duplicates. Guest attempts are always `provisional`.

## D13 — Leaderboards (P5)
Weekly board on the daily twister (Mon–Sun UTC), **verified-only**, display-name profanity filter, opt-out (`hide_from_boards`), ties → earliest, table `LeaderboardEntry` rebuilt hourly (not computed live).

## D14 — Deletion and export
JSON export (profile, attempts, stats) available before deletion. Delete request ⇒ media purged ≤ 24 h, PII anonymised ≤ 30 d, any worker-retained audio and donated audio deleted on request. Consent log retained per legal policy.

## D16 — Streak freezes
A freeze is banked each time `current_streak` reaches a multiple of 7 (`STREAK_FREEZE_EVERY`), capped at 2 (`STREAK_FREEZE_MAX`, also a DB CHECK). It is consumed automatically to bridge exactly one missed local day: the bridged day gets a `DailyActivity` row with `freeze_used=True`, `qualifies_streak=False`, and the streak continues (+1 for the day that just qualified). A gap of two or more days, or no freeze, resets the streak to 1. All rules live in `progress/streaks.py`.

## D17 — Recordings and streaks
A saved recording does not qualify for the streak; it only feeds the `recorded_1` achievement.

## D18 — Board names
Boards show `public_name` or a stable `Player NNNN`. Profiles with `hide_from_boards` and under-13s are excluded from both the weekly and the per-twister boards. Under-13 viewers get `403 minor_not_allowed` on boards.

## D19 — Achievement evaluation
Achievements are evaluated in-request inside a savepoint while the caller holds the Profile row lock; exceptions are logged and swallowed so a bad rule never fails an attempt. Rules are state-based and idempotent, so replays unlock nothing. Unlocks are never auto-revoked (admin can revoke). Catalogue size is 25. The earlier idea of extra `UserTwisterStats` columns was dropped: mastery is derived from existing stats.

---

## Still genuinely open (need real data, not more docs)
1. Whether the wav2vec2 phoneme model meets the acceptance targets on en-IN speakers → decided by the E3-5 gold set.
2. Model size after int8 export and which devices can run it comfortably → measured in E3-3.
3. Whether a Pro plan is worth building → after 60 days of P4 cap-hit data.
