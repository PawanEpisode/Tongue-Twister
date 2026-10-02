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

## D20 — Score cards have their own flag
`score_cards` (seeded **on**, kill switch) gates `POST /attempts/{id}/score-card/`, `GET /public/s/{token}/` and the image endpoint. Score cards store no media, so they must not wait for Supabase Pro; `share_links` stays tied to recordings. Turning `score_cards` off does not touch recording links and vice versa.

## D21 — Account deletion has a 30-day grace period
`DELETE /me/` (body `{"confirm":"DELETE"}`) makes the account *pending deletion* for `ACCOUNT_DELETION_GRACE_DAYS` (30). At once: every share link is revoked (public pages answer 410), the profile leaves both boards, expiry reminders stop, and every write except asking again, cancelling and export is refused with `403 account_pending_deletion`. Nothing is destroyed until the grace period is over, so the user can cancel (`DELETE /me/deletion/`, allowed until the purge actually runs). After it, `purge_deleted_accounts` (hourly) deletes the media objects from storage first, then the Profile row (everything else cascades), then the Supabase Auth user; a storage or Supabase failure leaves the account pending and the next run retries. This **deliberately deviates from D14's "media purged within 24 h of the request"**: D14's 24 h now counts from the end of the grace period. Links revoked on request stay revoked after a cancel (the owner makes new ones). Whether the consent log may be kept longer than the profile is a legal question for the owner (it cascades with the profile today).

## D22 — Export is a direct JSON download
`GET /me/export/` streams one JSON file (metadata only, no media bytes), throttled to 3 per hour per user and capped at `EXPORT_MAX_ATTEMPTS` (20 000, newest first, `truncated: true` when hit). Every section is an explicit field whitelist, so hashes, storage paths, signed URLs and worker-internal fields cannot leak by adding a model column. This replaces D14's "emailed zip".

## D23 — Night owl mode shifts the streak day
For profiles that opt in (`Profile.night_owl`), the streak day boundary is `NIGHT_OWL_CUTOFF_HOUR` (03:00) local time instead of midnight: activity from 00:00 to 02:59 counts for the previous local day. The shift lives in one place (`localtime.local_date`, plus `day_bounds`/`day_expr` for SQL) so streaks, `DailyActivity`, mastery days, the summary and the insights agree; a test fails if a module derives a local day by itself. The *wall clock* (`local_hour`) is not shifted: the at-risk hour and the clock-based badges use the real time. `night_owl` and `early_bird` (local hour 23:00-02:59 and 05:00-07:59 on a scored attempt) join the catalogue, which becomes **27**; both require a confirmed timezone (not the default `UTC`), because an unconfirmed zone would award them to the wrong people.

## D24 — Generate Twister uses Google Gemini over REST
The provider is Gemini (`GEMINI_MODEL`, default `gemini-2.5-flash`) called with stdlib `urllib`: no SDK dependency, an injectable transport for tests, a 10 s timeout and one retry on a 5xx or timeout. Output is structured JSON (`responseMimeType: application/json` plus a response schema). The key travels in a header, never in a URL; prompts and outputs are never logged (lengths and status codes only). `GENERATOR_BACKEND` is `gemini` or `fake`; blank means `gemini` when a key exists and `fake` (canned twisters, no network) otherwise, so development and CI never need a key.

## D25 — Generated twisters are private to their owner
A generated twister has `visibility = private` and an `owner`. The database requires private rows to be owned **and unpublished**, so every older `is_published` filter hides them without being edited, and public rows cannot be owned. Reads go through `Twister.objects.public()` (the catalogue: lists, facets, Random, Daily, categories, summary, boards, drill fallbacks, manifest, and the `POST /twisters/{slug}/favorite/` toggle) or `.visible_to(profile)` (opening and practising one twister: detail, history, attempts, sessions, recordings, plus the owner's own stars via `PUT`/`DELETE /me/favorites/{slug}/` and `GET /me/favorites/`). Anyone else's private slug is still a 404 on those favourite routes, and guest sync still imports public slugs only. The owner cannot publish a generated twister; they can practise, star, and delete it. Private twisters are included in the owner's data export and removed with the account (FK cascade).

## D26 — Generation safety and quota
The user's topic is data: control and invisible characters are stripped, it is capped at 120 characters, checked against the existing blocklist (`names.BLOCKED_TERMS`, applied word by word so "pass hit" is not flagged) and only ever sent as one JSON string value under a system instruction that calls it untrusted. The model's output is validated structurally (20-240 characters, 8-40 words, English letters and ordinary punctuation only, no links or markup, blocklist, every word must have a pronunciation) and rejected with `generation_rejected` otherwise; nothing is stored for a rejection. Quota is `GENERATE_DAILY_LIMIT` (5) per person per UTC day, reserved atomically before the provider is called and refunded only when the provider itself fails (deleting a twister never refunds), plus a 3 per minute throttle. People under 13 cannot generate (no child's text goes to a third-party model). The `generate_twister` flag gates generation only, so people can always list and delete what they have.

## D27 — Reminders are e-mail only, hourly, one a day, one click to stop
`ReminderPreference(profile, enabled, hour_local, last_sent_on)` is opt-in (no row = off). `send_reminders` runs hourly at `:07` and mails each person whose **wall-clock** hour in their own timezone is `hour_local`, who has not practised their streak day, and has not been mailed that day (`last_sent_on`, claimed by a conditional UPDATE before sending, released on failure). The hour is the real clock and the day is the night-owl-aware streak day, both from `localtime`; a spring-forward gap sends in the next hour, an autumn overlap still mails once. Profiles on the unconfirmed `UTC` placeholder zone, pending-deletion accounts and blank addresses are skipped; flag `reminders` gates sending (not the preference endpoint). Every mail carries RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post` pointing at a public, idempotent `GET|POST /public/unsubscribe/{token}/`; the token is the profile id signed with `SECRET_KEY` (own salt, no expiry), so there is no token table. Expiry reminders for recordings stay transactional and separate.

## D29 - The engine groundwork is pure, model-free and unwired
`twisters/speak/engine/` (Python reference) and `web/src/lib/speak/engine/` (TypeScript port) contain the E3-2 logic as functions over a log-posterior matrix, behind two seams (`Pronouncer`, `AcousticModel`). Nothing in Speak mode imports them (a test on each side scans for it), no flag is added and `accurate_mode` stays off, so behaviour is unchanged until E3-4. The synthetic bench (`bench.py`) is Python-only; the TypeScript tests consume stored matrices.

## D30 - Deliberate differences from the text of doc 10
(a) `weak` uses the best target log-probability inside the aligned span (`peak_lp`), not LPP: CTC posteriors are peaky, so a mean over peak +- 2 frames mixes in blank frames and would call correct phones slurred; LPP and LPR are still computed and returned. (b) Substitution/deletion tests run for focus phonemes, low-peak phonemes and phonemes whose heard label differs, not for every phoneme (cost). (c) Edit alignment resolves ties to the earliest match so a repeated phrase is credited to its first repetition; the whole-sequence test keeps the alignment-free property. (d) Credits stay as implemented in Score v2 (`near` 0.6, `extra` -0.15 capped -0.5), not the 0.5 / -0.25 in doc 10 §4.7. (e) All thresholds are placeholders pending E3-5.

## D31 - One generated vector file pins both runtimes
`api/tests/fixtures/engine_vectors.json` is written by `python -m tests.engine_vector_gen` and a Python test fails when it is stale. TypeScript must match every verdict, status, span and score exactly and floats within 2e-3. Changing an algorithm means regenerating the file in the same change and passing both suites.

## D32 - Reminders are email only; web-push and NotificationChannel are dropped
The 06d plan listed `NotificationChannel`, `PUT /me/notifications/` and web-push. They are dropped: D27's `ReminderPreference` plus a one-click unsubscribe covers the need with one channel, no service worker, no push subscriptions to store or expire, and no extra consent surface. Revisit only if e-mail open rates show reminders are not landing and users ask for push.

## D33 - Engine tests run on a neighbourhood, not the whole clip
Substitution and deletion tests use the tested word plus its placed neighbours (union of their windows) and a base probability computed once per neighbourhood. Measured on a 65-word, 15 s read: 19.3 s to 0.05 s with the same score. Python and TypeScript changed together and `engine_vectors.json` was regenerated (D31 still holds). Detail: `13` §3.1.

## D34 - A spot-check asks for audio, the client supplies it
The server picks the attempt (about 10 %, plus personal bests at or above 90), answers `spot_check.requested`, and the client uploads the clip (consent `voice_processing`, 13+) within 30 minutes and attaches it. No audio means no check: the attempt stays `device`. A job is only ever queued with audio attached. `13` §3.3.

## D35 - Only inflation and false credit are tampering
Flag when the device score exceeds the worker's by more than `SPOT_CHECK_MAX_DELTA`, or when a focus word the device credited is `wrong/focus_swap` on the worker. A device that was harsher than the worker is verified and logged for calibration. An unusable or mismatched clip is inconclusive, never a flag. `13` §3.4.

## D36 - Scoring jobs use the media queue design
Conditional-UPDATE claim with `SKIP LOCKED`, leases with heartbeats, `max_tries` 3, a partial unique index for one active job per attempt and kind, and a lease sweeper. Same operational model as `MediaJob`, so one runbook mental model covers both.

## D37 - The engine is Django-free and vendored into the worker
Score v2 lives in `engine/score.py` with plain string constants (a test pins them to the enums). The worker holds a copy produced by `worker/scripts/sync_engine.py`; a test fails if it drifts. No shared package, no build context change for Fly.

## D38 - The worker verifies the audio it scores
sha-256, size, duration within 10 % of the attempt and a maximum length (90 s) are checked before inference. Failures are `audio_mismatch` / `audio_too_long` and count as inconclusive.

## D39 - A model is identified by its hash everywhere
Manifest, browser cache, worker cache and every `Attempt.model_version` carry the file's sha-256; a mismatch is rejected before use. Rollback is deactivating the row; kill switches are ordered in `13` §6.

## D40 - The flap has its own class
`ɾ` maps to a heard-only class `DX`, not `R`. Accent packs decide what it may stand for (en-US: T or D between vowels, en-IN: R). The label-map tool fails on any vocabulary label that is neither mapped nor explicitly dropped.

## D41 - Spot-check audio is deleted when the job settles
Unless the user separately chose to keep the take (existing voice-clip rules), the clip is purged on `done`, `failed` or `expired`. Withdrawing `voice_processing` consent expires queued jobs. Under-13 accounts never reach this path.

---

## Still genuinely open (need real data, not more docs)
1. Whether the wav2vec2 phoneme model meets the acceptance targets on en-IN speakers → decided by the E3-5 gold set.
2. Model size after int8 export and which devices can run it comfortably → measured in E3-3.
3. Whether a Pro plan is worth building → after 60 days of P4 cap-hit data.
