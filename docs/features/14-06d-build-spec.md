# 14 — 06d Build Spec (Progress, mastery, achievements, stats, discovery)

Binding spec for the **core** 06d slice. Sources: `05` (PRD), `06d` (ERD), `07` §3/§8/§13, `09` E6.1–6.5, `11` D4/D5/D11/D13 + D16–D19 (added with this slice). Where this file and `05`/`06d`/`07` differ, **this file wins** (it is what gets built); after shipping it is folded into `07` + `12`.

## 0. Scope

**In (this round):** `/me/summary` + home strip (G1) · per-twister mastery state + Browse filter (G2) · streak engine with freezes (G3) · achievements engine, toasts, list (G4) · `/stats` page, activity heatmap, weak words (G5) · favourites list + Random (G6) · facet counts + sort (G7) · `DailyTwister` + `GET /daily/` · weekly leaderboard (`LeaderboardEntry`, hourly job, verified/opt-out/age rules, flag `weekly_boards`, **off** by default) · board-name privacy fix on the existing per-twister board.

**Deferred to the next 06d round** (nothing below is built or stubbed): score-card images + `/s/:token` OG landing (G8), Generate Twister (G9), reminders / `NotificationChannel` (G10), `TwisterGeneration`, CSV export, night-owl mode + `night_owl`/`early_bird` achievements, `GET /me/export/`, `DELETE /me/`.

## 1. Decisions taken for this slice (added to `11` as D16–D19)
- **D16 Streak freezes.** PRD says "earned by 3 consecutive days", ERD says "every 7-day streak". ERD wins: a freeze is banked each time `current_streak` reaches a multiple of 7 (max 2, `STREAK_FREEZE_MAX`). A freeze is consumed automatically to bridge **exactly one** missed local day; the bridged day gets a `DailyActivity` row with `freeze_used=True` and `qualifies_streak=False`, and the streak continues (+1 for the day that just qualified). A gap of 2+ missed days, or no freeze, resets to 1.
- **D17 A saved recording does not qualify for the streak** (PRD 05 §1 listed it; D4 and ERD 06d do not). It only feeds the `recorded_1` achievement. Streak qualifiers stay: any scored attempt, or a Read-along pass ≥ 1 with ≥ 30 s active.
- **D18 Board names.** Public boards show `Profile.public_name` (opt-in, already blocklist-validated) or `Player NNNN` (4 digits derived from a hash of the profile id, stable). `display_name`, e-mail and OAuth names are never shown. Applies to the new weekly board **and** the existing `GET /twisters/{slug}/leaderboard/`. `hide_from_boards` and `age_band == under13` exclude a profile from both boards; under-13 viewers get `403 minor_not_allowed` on boards.
- **D19 Achievements are evaluated in-request, not `on_commit`.** The attempt response must carry `achievements_unlocked`, so evaluation runs right after the attempt's rows are written, **inside a savepoint**, while the Profile row lock is held; any exception is logged and swallowed (an achievement bug must never lose an attempt). Rules are state-based (read current stats/DB, not event deltas) so a skipped evaluation self-heals on the next event. Unlocked rows are never auto-revoked (criteria changes, attempt deletion); `revoked` is admin-only (PRD edge 2 is an admin action).
- **Catalogue size is 25, not 24.** PRD 05 §5 lists 27 codes under a "24" heading. `night_owl`/`early_bird` are deferred (need the opt-in Night owl mode), which leaves 25. The API returns `total` from the database; nothing hard-codes a number.
- `UserTwisterStats.total_active_ms / read_along_ms / is_favorite` from ERD 06d are **not** added: Read-along time is `SUM(DailyActivity.read_along_ms)`, favourites are the `Favorite` table. Denormalised copies would need a second writer for no measurable gain.

## 2. Data model (migration `0012_progress_schema`, seeds in `0013_progress_seeds`)
Schema and data are separate migrations (PostgreSQL cannot ALTER after inserting rows that reference the table in one transaction — same reason as 0007/0008). Both reversible. No live-settings imports in migrations.

- `Profile.streak_freezes` `smallint default 0`, CHECK `0 ≤ x ≤ 2`; `Profile.hide_from_boards` `bool default false`.
- `Achievement` — `code` slug PK, `name`, `description`, `icon` (lucide icon name, see §7), `tier` (`bronze|silver|gold`, TextChoices + CHECK), `category` (`start|streak|mastery|skill|explore`), `criteria` JSON, `xp_reward` smallint, `verified_only` bool, `hidden` bool, `active` bool, `sort_order` smallint.
- `UserAchievement` — `profile` FK, `achievement` FK (`to_field=code`), `unlocked_at`, `progress` real (CHECK 0..1, nullable), `revoked` bool, `seen` bool; `UNIQUE(profile, achievement)`; index `(profile, seen)`.
- `DailyTwister` — `day` date PK, `twister` FK (`PROTECT`), `source` (`editorial|auto`), `locked_at`.
- `LeaderboardEntry` — `week_start` date, `twister` FK, `profile` FK (`CASCADE`), `best_score` smallint (CHECK 0..100), `best_attempt` FK (`SET_NULL`, nullable), `achieved_at`, `rank` int; `UNIQUE(week_start, twister, profile)`; index `(week_start, twister, rank)`.
- Seeds (`0013`): the achievement catalogue (frozen copy of `progress/catalogue.py` at this commit) and flags `achievements` **on**, `weekly_boards` **off**. Later catalogue edits go through the idempotent `sync_achievements` command (upsert by code; never deletes rows a user has unlocked — sets `active=false` instead).
- Django admin: `Achievement` (editable), `UserAchievement` (read-only + "revoke" action that sets `revoked`), `DailyTwister` (editable — this **is** the editorial override), `LeaderboardEntry` (read-only).

## 3. API package `api/twisters/progress/` (one responsibility per file, no logic in views)

| File | Responsibility |
|---|---|
| `twisters/levels.py` (outside the package, no model imports) | `level_for(xp)`, `level_floor(level)`, `level_progress(xp) -> (into, needed)`. `Profile.level` calls `level_for`. Formula `1 + xp // 200` lives only here (replaceable by `200·level^1.15`). |
| `streaks.py` | Pure helpers + the DB step. `effective_streak(profile, today)`, `next_milestone(streak)`, `is_at_risk(profile, now)`, `advance(profile, day)` (called by `practice/services._mark_streak`, which shrinks to a one-line delegate — streak rules live here only). Rules per D16. Back-dated (offline) days keep today's behaviour: they qualify but do not move the streak. |
| `mastery.py` | `mastery_state(stats) -> "new"|"practising"|"almost"|"mastered"` (almost ⇔ best of `best_score`/`best_practice_score`/`best_test_score` ≥ `MASTERY_ALMOST_SCORE`=80); `mastery_states_for(profile) -> dict[twister_id, state]` (one query). |
| `catalogue.py` | `AchievementDef` dataclass + `CATALOGUE` tuple (single source of truth) + `upsert_catalogue(model=Achievement)` used by the command. |
| `achievements.py` | Rules engine (see §3.1). |
| `summary.py` | Builds the `/me/summary/` body from the pieces above. |
| `insights.py` | Builds `/me/stats/` and `/me/activity/` bodies (range parsing, series, rolling mean). Reuses `speak.queries`/`speak.views.weak_words` query helpers for weak words — **do not re-implement**. |
| `browse.py` | `apply_status`, `apply_sort`, `facets`, `pick_random` (injectable `random.Random`), used by `TwisterViewSet`. |
| `daily.py` | `daily_twister(day) -> (DailyTwister)`: row if present else deterministic pick, persisted with `get_or_create` (race-safe, never changes once created). Pick rule stays `published_ids[day.toordinal() % n]` so today's pick does not change on deploy. |
| `boards.py` | `board_name(profile)`, `week_start(dt)`, `rebuild_week(week_start, twister)`, `eligible_attempts(week_start)` (built on `speak.queries.leaderboard_attempts()`), read helpers for the two board endpoints. |
| `serializers.py`, `views.py` | Thin. Views only validate params, call services, shape the response. |
| `management/commands/` | `sync_achievements`, `build_leaderboard` (hourly: current + previous week, for every twister that was a `DailyTwister` in that week; one transaction per (week, twister): delete + `bulk_create` ranked rows). Both go into `.github/workflows/manage-command.yml` allow-list; `build_leaderboard` cron hourly at `:37`. |

Settings (env, safe defaults, all in `config/settings.py`): `STREAK_FREEZE_MAX=2`, `STREAK_FREEZE_EVERY=7`, `STREAK_MILESTONES=(3,7,14,30,60,100)`, `STREAK_AT_RISK_HOUR=18`, `MASTERY_ALMOST_SCORE=80`, `LEADERBOARD_TOP_N=10`, `RANDOM_WEIGHTS={"new":60,"practising":30,"mastered":10}`, `RANDOM_EXCLUDE_MAX=20`, `STATS_MAX_POINTS=400`.

### 3.1 Achievements engine
```
Event(kind: "attempt"|"session"|"recording", profile, attempt=None, twister=None, twister_stats=None, previous_best=None)
evaluate(event) -> list[Unlocked]           # idempotent; grants xp_reward to profile.xp
catalogue_view(profile) -> list[AchievementView]   # same rules, used for progress bars
```
- A rule is `@rule("<criteria.type>", events={...})` returning `Outcome(met: bool, progress: float | None)`. One registry dict; unknown `criteria.type` in data ⇒ rule skipped and logged (never crashes). Adding a rule = one function + one catalogue row.
- `evaluate` loads the profile's not-yet-unlocked active achievements once, runs only rules subscribed to `event.kind`, and inserts `UserAchievement` with `get_or_create` (unique constraint = idempotence). `xp_reward` is added to `profile.xp` (caller holds the lock) and `DailyActivity` is **not** touched. `verified_only` rules only count attempts with `trust.counts_for_mastery(attempt, distrusted=…)`.
- `progress` is a fraction for counter-shaped rules (`streak`, `mastered`, `category_mastered`, `read_along_ms`, `categories_attempted`, `levels_passed`, `recordings_saved`, `attempts`) and `null` for event-shaped rules (`attempt_score`, `attempt_wpm`, `score_gain`) — no fake meters.
- Catalogue (25). Criteria `type` in backticks.

| code | name | tier | criteria | xp | verified_only |
|---|---|---|---|---|---|
| `first_word` | First Words | bronze | `attempts` min 1 | 10 | no |
| `first_test` | Put to the Test | bronze | `test_attempts` min 1 | 10 | no |
| `streak_3` `streak_7` `streak_14` `streak_30` | Warming Up / On Fire / Two Weeks / Unstoppable | bronze / silver / silver / gold | `streak` min 3/7/14/30 (uses `best_streak`) | 15/30/50/100 | no |
| `mastered_1` `mastered_10` `mastered_50` `mastered_100` | Tongue Tied No More / Word Smith / Twister Pro / Legend | bronze / silver / gold / gold | `mastered` min 1/10/50/100 | 25/60/150/300 | no (mastery already enforces trust) |
| `perfect_100` | Flawless | gold | `attempt_score` min 100, `min_words` 10, kind test/record | 50 | **yes** |
| `insane_clear` | Insane in the Membrane | gold | `attempt_score` min 80, `difficulty` 4 | 50 | **yes** |
| `marathoner` | Marathoner | silver | `attempt_score` min 80, `min_words` 100 | 40 | **yes** |
| `speed_demon` | Speed Demon | silver | `attempt_wpm` min 180, `min_accuracy` 0.9 | 40 | **yes** |
| `sweep_hissers` `sweep_poppers` `sweep_rollers` `sweep_th` `sweep_vowels` `sweep_benders` | Hisser / Popper / Roller / TH / Vowel / Bender Master | silver | `category_mastered` category slug, min 5 (slugs: `hissers poppers rollers th-tangles vowel-vortex brain-benders`) | 50 | no |
| `all_levels` | Ladder Climber | silver | `levels_passed` min_score 80 on each of difficulty 1–4 (Test, unflagged, current version) | 40 | **yes** |
| `read_10min` | Steady Pacer | bronze | `read_along_ms` min 600000 (sum of `DailyActivity.read_along_ms`) | 20 | no |
| `recorded_1` | On Camera | bronze | `recordings_saved` min 1 (ready, not deleted) | 20 | no |
| `comeback` | Comeback Kid | silver | `score_gain` min 25 (this attempt's score − `previous_best`, both current-version tests; needs a previous best) | 30 | **yes** |
| `explorer` | Explorer | silver | `categories_attempted` all (every category that has a published twister) | 30 | no |

Hook points (each passes `Event`; all inside a savepoint via one helper `progress.achievements.safely(event)` that returns `[]` on error):
1. `speak/service.submit` after `stats.record_attempt`, **before** `level_up` is computed, only when the attempt earns progress (`xp is not None`, i.e. not flagged / guest import / too old). `previous_best` = the best earlier test score already computed for `is_best`. `Result` gains `achievements_unlocked: list` → `result_body` returns them as `[{code,name,description,icon,tier,xp_reward}]` (today hard-coded `[]`).
2. `practice/views` session PATCH when a Read-along session finishes → `achievements_unlocked` added to the `SessionResult` body.
3. Recording `complete` (media/recordings.py) → `recording` event; the unlocked list is **not** added to that response (contract unchanged); it arrives via `unseen_achievements` in `/me/summary/` (web refetches summary after a save).
Guest sync imports evaluate nothing (they earn no progress); the next live event catches up because rules are state-based.

## 4. Endpoints (all under `/api/v1`, shared error envelope, `X-Request-Id`)

| Endpoint | Auth | Behaviour |
|---|---|---|
| `GET /me/summary/` | 🔐 | `{"mastered":12,"total":205,"current_streak":4,"best_streak":6,"streak_at_risk":true,"streak_freezes":1,"next_streak_milestone":7,"practised_today":false,"achievements":{"unlocked":6,"total":25},"xp":420,"level":3,"xp_in_level":20,"xp_for_next_level":200,"timezone":"Asia/Kolkata","today":"2026-10-01","unseen_achievements":[{code,name,description,icon,tier,xp_reward,unlocked_at}]}`. `current_streak` is the **effective** streak (0 once lapsed, stored value untouched). `streak_at_risk` = effective streak > 0 ∧ not practised today ∧ local hour ≥ `STREAK_AT_RISK_HOUR`. `total` = published twisters. `private, no-store`. ≤ 8 queries (test with `django_assert_max_num_queries`). |
| `GET /me/achievements/` | 🔐 | `{"unlocked":6,"total":25,"results":[{code,name,description,icon,tier,category,xp_reward,unlocked_at|null,progress|null,seen}]}`; ordered `sort_order`; revoked = locked; `hidden` and locked ⇒ name `"Secret achievement"`, description `"Keep practising to find it."`, `icon:"lock"`, `progress:null`. |
| `POST /me/achievements/seen/` | 🔐 | `{codes?:[…]}` (omit = all unseen) → `200 {"marked":n}`; unknown codes ignored. |
| `GET /me/stats/?range=7d\|30d\|90d\|all&mode=speak_score\|read_along\|record` | 🔐 | See §4.1. Bad `range`/`mode` → `400 validation_error`. |
| `GET /me/activity/?weeks=12` | 🔐 | `weeks` 1–52 (default 12). `{"from":"2026-07-13","to":"2026-10-01","days":[{"date","attempts","active_ms","read_along_ms","qualifies_streak","freeze_used"}]}` — only days that have a row; oldest first; dates are the stored `local_date`. |
| `GET /me/favorites/` | 🔐 | Paginated `{count,next,previous,results:[Twister]}` (same serializer + context as Browse), newest favourite first. |
| `PUT /me/favorites/{slug}/` · `DELETE /me/favorites/{slug}/` | 🔐 | Idempotent set-state → `200 {"is_favorite":true|false}`; unknown/unpublished slug `404`. The old toggle `POST /twisters/{slug}/favorite/` stays. |
| `GET /twisters/` (extended) | 🔓 | New params: `status=mastered\|in_progress\|not_started\|favorites` (🔐; anonymous ⇒ `400 validation_error` "Sign in to filter by progress"), `sort=recommended\|newest\|shortest\|longest\|hardest\|easiest\|best_desc\|best_asc`, `q` (alias of `search`). Existing `difficulty`, `category`, `origin`, `min_words`, `max_words`, `search`, `ordering` unchanged (`level` alias is **not** added: `difficulty` is the established name). `sort` wins over `ordering`; unknown `sort` ⇒ 400. `recommended`: anonymous = default order; signed-in = unmastered before mastered, then default order. `best_*` orders by the caller's best test score (nulls last for desc, first for asc) via a subquery on `UserTwisterStats`, never a per-row query. |
| `GET /twisters/facets/` | 🔓 | Same filters as the list **except** `status`/`sort`. `{"total":205,"levels":{"1":16,"2":74,"3":85,"4":30},"categories":{"hissers":34,…},"origins":{"classic":…,"modern":…}}`. Each facet ignores its own dimension's filter (standard faceting) so the chips show what you would get by switching. Anonymous: `Cache-Control: public, max-age=60, stale-while-revalidate=300`. |
| `GET /twisters/random/?difficulty=&category=&origin=&exclude=a,b` | 🔓 | One Twister (list serializer). Candidates = filters minus `exclude` (≤ `RANDOM_EXCLUDE_MAX` slugs, extra ⇒ 400). Signed-in: pick a bucket by `RANDOM_WEIGHTS` over {`new`,`practising`,`mastered`} (empty buckets dropped and weights renormalised), then uniform inside it. Anonymous: uniform. Empty ⇒ `404 not_found`. `no-store`. |
| `GET /daily/?day=YYYY-MM-DD` | 🔓 | `{"day","source":"auto\|editorial","twister":{…Twister…}}`; default today **UTC**; `day` may be today or up to 60 days back (else 400). `GET /twisters/daily/` remains (bare twister) and delegates to the same service. Cache `public, max-age=60`. |
| `GET /leaderboard/weekly/?twister=<slug>` | 🔓 | Flag `weekly_boards` off ⇒ `403 feature_disabled`; under-13 viewer ⇒ `403 minor_not_allowed`. `twister` defaults to today's daily twister. `{"week_start":"2026-09-28","week_end":"2026-10-04","twister":{slug,text},"top":[{"rank":1,"name":"Player 4821","emoji":"🗣️","score":96,"achieved_at":"…","is_me":false}],"me":{"rank":7,"score":81}|null,"hidden":false,"updated_at":"…"|null}`. `top` ≤ `LEADERBOARD_TOP_N`; `me` present for signed-in viewers with an entry (even outside the top); `hidden` = viewer opted out. Tie-break: higher score, earlier `achieved_at`, then profile id. Reads only `LeaderboardEntry` (no live aggregation). |
| `GET /twisters/{slug}/leaderboard/` (existing) | 🔓 | Shape unchanged (`[{user,emoji,score}]`); `user` now from `board_name`; excludes `hide_from_boards` and under-13 (D18). |
| `GET /me/` · `PATCH /me/` | 🔐 | Add `hide_from_boards` (writable), `streak_freezes` (read-only). `timezone` is already writable here; there is **no** separate `POST /me/timezone/` (07 §8 is superseded: one way to do it). |
| `TwisterSerializer` | — | New field `mastery`: `"new"\|"practising"\|"almost"\|"mastered"` for signed-in callers, `null` for anonymous. `best_score`/`is_favorite` unchanged. |

### 4.1 `GET /me/stats/`
```json
{"range":"30d","mode":null,"from":"2026-09-02","to":"2026-10-01",
 "kpis":{"attempts":48,"practice_ms":1530000,"avg_score":71.4,"best_streak":6,"mastered":12,"xp":420,"level":3},
 "score_series":[{"date":"2026-09-02","avg":71.5,"rolling":70.2,"count":3}],
 "speed_series":[{"date":"2026-09-02","avg_wpm":118.4}],
 "attempts_by_day":[{"date":"2026-09-02","attempts":3,"active_ms":41000}],
 "category_accuracy":[{"category":"hissers","name":"Hissers","avg_accuracy":0.78,"attempts":12}],
 "weak_words":[{"word":"pickled","miss_rate":0.62,"seen":21,"drill":{…same as /me/words/weak/…}|null}]}
```
- Days are the user's **local** dates (`Attempt.created_at` converted with the profile tz; one helper shared with `practice.services.local_date`). `from`/`to` inclusive; `all` starts at the first attempt or activity.
- `avg_score`, `score_series`, `speed_series`, `category_accuracy` use unflagged current-version **test and record** attempts (train/drill are partial and would skew them). `mode=speak_score` ⇒ kinds test/train/drill for counts, test only for scores; `mode=record` ⇒ kind record; `mode=read_along` ⇒ scored series empty and `attempts_by_day.active_ms` = `read_along_ms`; `practice_ms` = `SUM(Attempt.duration_ms)` + `SUM(DailyActivity.read_along_ms)` for `mode=null`.
- `rolling` = 7-day trailing mean weighted by `count`. Series are capped at `STATS_MAX_POINTS`; a longer `all` range is bucketed by ISO week (`date` = Monday). `weak_words` top 10 by weakness (reuse the `/me/words/weak/` query, not a copy).

## 5. Wiring changes to existing code (keep them small and tested)
- `practice/services._mark_streak` → `streaks.advance`. `Profile.level` → `levels.level_for`. `speak/serializers.profile_summary` adds `streak_freezes`? **No** — keep the attempt response's `profile` block unchanged (additive-only, and the web reads the summary separately).
- `speak/service.Result` + `result_body` carry `achievements_unlocked`; session PATCH does the same.
- `TwisterViewSet`: `get_serializer_context` adds `mastery_states` (one query) next to `favorite_ids`/`best_scores`; `filter_queryset` applies `progress.browse`; new `@action`s `facets`, `random`; `daily` delegates to `progress.daily`. Query counts for the list endpoint must not grow with page size (test).
- `.github/workflows/manage-command.yml`: add `sync_achievements`, `build_leaderboard` to `ALLOWED`; cron `37 * * * *` for `build_leaderboard`.

## 6. API tests (pytest, sqlite + Postgres CI; no network)
Each new module has its own test file `tests/test_progress_*.py`. Must cover:
- **streaks:** consecutive days; single missed day with/without a freeze; two missed days resets; freeze earned at 7 and 14, capped at 2, never earned twice for the same day; bridged day row has `freeze_used`; back-dated day doesn't move the streak; `effective_streak` for today/yesterday/2-days-ago(+freeze)/older; timezone boundary (attempt at 23:30 and 00:30 local across a UTC day); `is_at_risk` around `STREAK_AT_RISK_HOUR`; Read-along qualification unchanged.
- **levels:** formula, boundaries, progress tuple.
- **mastery:** states from stats rows; `mastery_states_for` is one query.
- **achievements:** every rule type met / not met / boundary (99 vs 100, 179 vs 180 wpm, 24 vs 25 gain, 4 vs 5 mastered in a category); idempotent (evaluate twice ⇒ one row, XP once); `verified_only` ignores unverified/flagged; hidden locked masking; unknown criteria type skipped; an exploding rule leaves the attempt saved and returns `[]`; unlock appears in the `POST /attempts/` response and in `unseen_achievements`; `seen` endpoint; revoked counts as locked and is not re-granted; `sync_achievements` idempotent and deactivates removed codes without touching user rows; guest-sync import unlocks nothing; catalogue has unique codes, valid tiers, every rule type registered.
- **summary/stats/activity:** shapes, empty account, range/mode validation, local-date bucketing, rolling mean numbers checked by hand, weak-words reuse, `all` bucketing, N+1 guard, other users' data never leaks (IDOR-style).
- **favourites:** list order, idempotent PUT/DELETE, 404s, old toggle still works, anonymous 401.
- **browse:** each `status` value (incl. anonymous 400), every `sort` (incl. `best_*` null ordering), `q` alias, facets exclude-own-dimension maths, facets cache header, query count independent of page size; `random`: respects filters and `exclude`, weights (seeded `Random`, distribution within tolerance), empty buckets renormalise, 404 on empty, exclude cap.
- **daily:** stable once created, editorial row wins, concurrent `get_or_create` race (IntegrityError path), day bounds, legacy endpoint parity.
- **boards:** eligibility (flagged, unverified when required, `hide_from_boards`, under-13, outside the week window), ranking and tie-breaks, rebuild idempotent and replaces stale rows, flag off ⇒ 403, under-13 viewer ⇒ 403, `me` outside top-N, `board_name` never exposes `display_name`/e-mail and is stable, old endpoint uses it, deleting a profile removes its rows, command runs.
- **migrations:** 0012/0013 forward and backward with data present; flags seeded off/on as specified.
- Existing suites stay green; update only tests whose contract this spec deliberately changes (old leaderboard name), and say so in the PR notes.

## 7. Web (`web/src`, TanStack Start + React 19)
Conventions as 06c: pure logic in `lib/progress/` with tests beside it, UI in `components/progress/`, types + calls only in `lib/api.ts`, strict TS (no `any`), a11y (labelled controls, `aria-live` for toasts, colour never the only signal, reduced-motion respected), skeleton / error / empty state for **every** data card, unit tests (vitest) for every pure module and for hooks where the repo already tests hooks. Load the `dataviz` skill before writing any chart code and use the app's existing CSS variables/Tailwind tokens (light + dark), not a new palette.

**`lib/api.ts`** — types `MasteryState`, `Summary`, `AchievementView`, `UnlockedAchievement`, `StatsRange`, `StatsMode`, `Stats`, `ActivityDay`, `Facets`, `BrowseSort`, `BrowseStatus`, `DailyPayload`, `WeeklyBoard`; `Twister.mastery: MasteryState | null`; `AttemptResult.achievements_unlocked`; `SessionResult.achievements_unlocked?`; `Profile.hide_from_boards?`, `streak_freezes?`; methods `summary`, `achievements`, `markAchievementsSeen`, `stats`, `activity`, `favorites`, `setFavorite(slug, on)`, `facets`, `randomTwister`, `daily` (now reads `/daily/` and returns the twister), `weeklyBoard`; `twisters()` gains `status`, `sort`. `DEFAULT_FLAGS` gains `achievements: true`, `weekly_boards: false`.

**`lib/progress/`** — `streak.ts` (milestone progress, at-risk copy, freeze copy), `charts.ts` (linear/band scales, line/area path builders, rolling-mean display helpers, heatmap grid: weeks × weekdays, Monday-first, intensity buckets, locale-safe date labels — all pure), `recent.ts` (last-N twisters already shown by Random, per browser, capped at `RANDOM_EXCLUDE_MAX`), `achievements.ts` (toast queue: dedupe by code across response-supplied and summary-supplied unlocks, mark-seen batching), `browseParams.ts` (validate/serialise `status`/`sort` search params; invalid values fall back silently), `useSummary.ts`, `useAchievementToasts.ts`, `useFavorite.ts` (optimistic, explicit target state via PUT/DELETE, rollback on error, invalidates `['twisters']`, `['favorites']`, `['summary']`), `useBrowserTimezone.ts` (once per device: if the profile timezone is still `UTC` and the browser's IANA zone differs, `PATCH /me/ {timezone}`; storage-guarded, silent).

**Components** (`components/progress/`): `ProgressStrip` (3 tiles: Mastered `n/total`, Streak with flame + freeze pips, Achievements `n/total`; each links to `/stats`; skeleton, error with retry, guest variant with zeros + "Sign in to save your progress" once the guest has a local attempt), `StreakBanner` (at-risk nudge), `MasteryBadge` (icon + text label + colour; states new / practising / almost / mastered), `FavoriteButton` (used on cards and in `HubHeader` — replace the hub's own toggle with it, don't duplicate), `RandomButton`, `SortMenu` (dropdown-menu primitive already in `ui/`), `StatusChips`, `AchievementToaster` (mounted once in `__root`; confetti only when motion is allowed; `role="status"`), `AchievementGrid` (tier, locked/unlocked, progress bar with `aria-valuenow`), charts `ScoreChart`, `SpeedChart`, `ActivityHeatmap`, `BarList` (category accuracy), each with a visually-hidden data table fallback, hover/focus tooltips and keyboard-reachable points, `WeakWordsCard` (links into `/practice` drills with the existing `drill` shape), `WeeklyBoard` (behind `weekly_boards`; "Hide me from boards" toggle; your rank if outside top 10).

**Routes** — `/stats` (signed-in only; guests see a sign-in prompt with the benefits; range tabs 7d/30d/90d/all, mode select, KPI tiles, charts, weak words, achievements; `validateSearch` for `range`/`mode`), `/favorites` (reuses the Browse grid + skeletons + empty state "Star a twister to find it here"), Browse `/twisters` gains `status` + `sort` search params, status chips (signed-in only), sort menu, **facet counts on the level / sound-family / origin chips**, Random button (navigates to the twister; passes the current filters; keeps the last 5 in `recent`), `TwisterCard` shows `MasteryBadge` + best chip + `FavoriteButton`. Home: `ProgressStrip` above the hero cards, the daily card becomes "Try this twister!" with difficulty badge, best score or "N/A", mastery and ★, `WeeklyBoard` section (flag). Header: Stats and Favourites links for signed-in users; the streak chip links to `/stats` and uses the effective streak from the summary. `ResultCard` shows freshly unlocked achievements inline in addition to the toast. `sitemap` untouched (all new pages are private).

**Web tests:** every file in `lib/progress/` (scales, rolling window, heatmap grid incl. month boundaries and Sunday/Monday start, toast dedupe, search-param validation, streak copy, recent-list cap, optimistic favourite rollback, timezone once-per-device), plus rendering tests for `ProgressStrip` (loading / error / empty / data / guest) and `AchievementGrid` if the repo's testing setup supports component tests (it does for hooks; keep component tests light).

## 8. Definition of done (this slice)
API: `ruff check` + `ruff format --check` clean, full pytest green on sqlite (Postgres run is CI's job — note it unverified locally), migrations reversible. Web: `prettier --check`, `tsc --noEmit`, `eslint`, full vitest green. Docs: `07` gets §15 "As built (06d core)", `11` D16–D19, `12` gets the 06d breakdown + deviations + the **pending list**, `05`/`06d` get a one-line pointer to this file and the corrected catalogue size. No file outside the scope above is reformatted.
