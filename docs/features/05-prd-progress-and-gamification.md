# PRD 05 — Progress, Mastery & Gamification

Ties the three modes together and drives return visits. Inspired by the reference app's home strip (Mastered / Streak / Achievements), Favorites / Random / Stats shortcuts, score history, and "Generate Twister".

## 1. Concepts

| Concept | Definition |
|---|---|
| **Attempt** | One scored (Test) or practice (Train) pass in Speak & score, or an analysed Record take |
| **Practice session** | A continuous stretch on one twister in any mode (see 06 `PracticeSession`) |
| **Best score** | Highest *Test* score for a twister (score_version-aware) |
| **Mastered** | Test score ≥ 90 on **two different local days** within 30 days (config) |
| **Streak** | Consecutive local days with ≥ 1 *qualifying activity* |
| **XP / Level** | XP accumulates; level = `1 + floor(xp/200)` today; move to a soft curve later (`200 * level^1.15`) |
| **Achievement** | Badge unlocked by a rule on events/stats |

**Qualifying activity for streak:** one completed Test or Train attempt, or one full Read-along pass, or one saved recording. Timezone = user's profile timezone (fallback: browser offset at first activity).

## 2. Home strip & featured twister

`Mastered 12/205 · Streak 🔥 4 · Achievements 🏅 6/24`, three compact stat tiles (tap → Stats page). Below: "Try this twister!" (daily) card with difficulty badge, **best score** (or "N/A"), favourite ★. Guests see the tiles with 0s and a "Sign in to save your progress" strip after their first attempt.

Skeletons + error states for the strip (same treatment as existing cards).

## 3. Streaks (rules & edge cases)
- Day boundary at local midnight. Late-night activity (00:00–02:59) may count for the previous day **only** if the user opts into "Night owl mode" (P3; default off).
- **Streak freeze:** one auto-freeze per 7 days earned by 3 consecutive active days (max 2 stored). Freeze consumed automatically if a day is missed.
- Timezone change / travel: streak computed from stored `local_date` per activity, not recomputed from UTC; changing tz applies going forward only; cap streak jumps at +1/day.
- Backfill/clock manipulation: server assigns `local_date` from server time + user tz, ignores client dates > 24 h in the past/future.
- Display: current, best, "days until next milestone (3/7/14/30/60/100)"; at-risk warning after 18:00 local if today has no activity ("Practise 1 twister to keep your 4-day streak").
- Reminders (P5, opt-in): email/web-push at user-chosen time; no dark patterns, one-tap unsubscribe.

## 4. Mastery
- Progress ring per twister on the card/side panel: 0 attempts · Practising · Almost (best ≥ 80) · **Mastered ✔**.
- Mastery can lapse? **No** — once mastered, stays mastered (badge history). A "Refresh" nudge appears after 60 days.
- Filters on Browse: All · Not started · In progress · Mastered · Favourites.

## 5. Achievements (catalogue v1 — 25 shipped; see `14-06d-build-spec.md`)

> Built in `14-06d-build-spec.md`. The table lists 27 codes: `night_owl`/`early_bird` are deferred with Night owl mode, and the six `sound_sweep_*` rows ship as `sweep_hissers` … `sweep_benders`, leaving 25.


| Code | Name | Rule |
|---|---|---|
| first_word | First Words | Complete any attempt |
| first_test | Put to the Test | First Test attempt |
| streak_3 / 7 / 14 / 30 | Warming Up / On Fire / Two Weeks / Unstoppable | Streak length |
| mastered_1 / 10 / 50 / 100 | Tongue Tied No More … Legend | Mastered count |
| perfect_100 | Flawless | Score 100 on any twister ≥ 10 words |
| insane_clear | Insane in the Membrane | Score ≥ 80 on an Insane twister |
| marathoner | Marathoner | Score ≥ 80 on a 100+ word twister |
| speed_demon | Speed Demon | ≥ 180 effective WPM with accuracy ≥ 90 % |
| sound_sweep_* | Hisser / Popper / Roller / TH / Vowel / Bender master | Master 5 in a category |
| all_levels | Ladder Climber | Test-pass ≥ 80 on each level |
| read_10min | Steady Pacer | 10 min total Read-along |
| recorded_1 | On Camera | Save first recording |
| comeback | Comeback Kid | Raise a twister's best score by ≥ 25 points |
| explorer | Explorer | Attempt in every category |
| night_owl / early_bird | — | Activity before 6 am / after 11 pm (opt-in tz-safe) |

Rules are data (`Achievement.criteria` JSON) evaluated by a small server-side rules engine on `attempt_created`, `session_completed`, `recording_saved`. Unlock is idempotent; toast + confetti (respecting reduced motion); shown on Stats with progress bars for locked ones.

## 6. Stats page (`/stats`)
- KPI tiles: attempts, practice minutes, avg score (30 d), best streak, mastered, XP/level.
- Charts (SVG, accessible tables fallback): score over time (rolling avg), attempts per day heatmap (12 weeks), accuracy by sound family (radar/bars), speed trend, weakest words (top 10 by miss rate across attempts, tap → drill).
- Filters: 7 d / 30 d / 90 d / all; mode filter.
- Empty states and skeletons for each card; export CSV (P5).

## 7. Favourites & Random
- ★ on cards and the hub header; `/favorites` list (uses Browse grid, same skeletons). Guests: local favourites merged on sign-in.
- **Random** button: picks an unmastered twister in the current filter (weighted: 60 % unattempted, 30 % in progress, 10 % mastered). Never repeats the last 5.

## 8. Generate Twister (AI)
Reference offers "Generate Twister — create a fresh tongue twister!". Ours:

- Inputs: target sounds (chips: s, sh, r, l, th, p/b…), difficulty, length (short/medium/long), theme (free text, ≤ 40 chars), tone (silly/classic/techy).
- Output: 1 twister + tip + focus sounds + estimated difficulty; user can **Regenerate**, **Practise now**, **Save to My twisters**.
- Guardrails: content-safety filter on prompt and output (reject slurs, sexual, violent, personal names of private individuals, brands as trademarks); profanity list; max 240 chars/100 words; quality check (must contain ≥ 60 % target-sound alliteration, verified by a script); **rate limit** 10/day free; cost cap per user and globally; kill switch flag.
- Generated twisters are **private to the creator** (`visibility=private`, `source=ai`); never appear in public search until moderated; no sharing links in v1. Under-13: disabled.
- Determinism/provenance: store prompt params + model id + moderation result (06 `TwisterGeneration`).
- Edge: LLM outage → friendly error with retry; empty/garbled output → auto-retry once; duplicate of existing twister → return existing slug instead.

## 9. Discovery on Browse (from the reference)
- Level chips show **counts** (Easy 16 · Medium 74 · Hard 85 · Insane 30) computed by API facets.
- Sort menu: Recommended · Newest · Shortest · Longest · Hardest · Easiest · My best (asc/desc).
- Search across text/tip/focus sounds; debounced 250 ms; recent searches (local).
- Card badges: ★ favourite, ✔ mastered, best score chip.

## 10. Sharing
- **Score card:** server-rendered image (1200×630 + 1080×1080) with twister excerpt, score ring, name/emoji (opt-in), brand; short link `/s/:token` → landing page with OG tags and "Try this twister" CTA. No personal audio/video.
- Native share sheet on mobile; copy link; no leaderboards of guests.

## 11. Leaderboards (light, P5+)
Per-twister top 10 already in API. Add weekly board (Mon–Sun UTC) on the daily twister; display names must pass a profanity filter; users can opt out ("Hide me from boards"); server-verified attempts only; ties broken by earliest.

## 12. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| G1 | Home strip: mastered/streak/achievements | P1 |
| G2 | Per-twister mastery state + Browse filter | P1 |
| G3 | Streak engine with tz-correct local dates and freezes | P1 |
| G4 | Achievements engine + toasts + Stats list | P2 |
| G5 | Stats page with charts and weak words | P2 |
| G6 | Favourites list and Random | P1 |
| G7 | Facet counts + sort on Browse | P1 |
| G8 | Score card share | P2 |
| G9 | Generate Twister with safety | P3 |
| G10 | Reminders (opt-in) | P3 |

## 13. Edge cases
1. Two attempts in the same second (double submit) → idempotency key.
2. Achievement unlocked by an attempt later flagged as fraud → revoke silently, recompute stats.
3. Deleting an attempt/recording → recompute best/mastered/streak (streak days remain if other activity exists that day).
4. Score-version change (v1→v2) → best scores are **not** rescaled; show "(v1)" tag in history tooltip; mastery uses v2 only for new attempts after migration date, with v1 grandfathered for existing mastered flags.
5. User changes display name to something offensive → filter + fallback to "Player 1234" on boards.
6. Guest activity on multiple devices → cannot merge; only the device that signs in migrates.
7. Very active users (> 200 attempts/day) → soft rate limit; XP diminishing returns after 100 XP/twister/day.
8. Timezone missing → use UTC and prompt to confirm tz in Settings.
9. Deleting account → anonymise leaderboard entries or delete them (user choice); export offered first.
10. Empty states everywhere (no favourites, no attempts, no achievements) with a clear next action.
