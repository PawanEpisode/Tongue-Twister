# Twister Practice Suite — Overview & Roadmap

**Status:** Draft v0.1 · **Owner:** Pawan · **Applies to:** `/twisters/:slug` (the twister detail page) and everything reachable from it

## 0. How to read this doc set

| File | Purpose | Read if you are… |
|---|---|---|
| `00-overview-and-roadmap.md` | Vision, principles, feature map, phasing, cross-cutting rules | Everyone |
| `01-prd-practice-hub.md` | The twister page shell: mode switcher, shared settings, permissions | Frontend / design |
| `02-prd-read-along-mode.md` | Mode A — no-mic teleprompter / karaoke reader with speed control | Frontend |
| `03-prd-speak-and-score-mode.md` | Mode B — mic-checked practice (improves today's flow): mistakes view, train/test, history | Frontend + backend |
| `04-prd-record-mode.md` | Mode C — Loom-style camera/screen recording with layouts and review | Frontend + backend + infra |
| `05-prd-progress-and-gamification.md` | Results, history, mastery, streaks, achievements, favourites, stats, generate-a-twister | Product / backend |
| `06-erd-practice-features.md` | Data model (Mermaid ERD), constraints, storage policies, migrations | Backend / DBA |
| `07-api-contract.md` | REST endpoints, payloads, errors, upload flow | Backend + frontend |
| `08-ux-flows-and-edge-cases.md` | State machines, copy, accessibility, QA matrix, edge-case catalogue | QA / design / everyone |
| `09-implementation-plan.md` | Epics, ticket breakdown, sequencing, telemetry, rollout, risks | Eng lead |

Existing docs (`docs/PRD.md`, `docs/ERD.md`, `docs/ARCHITECTURE.md`) remain the baseline; this set **extends** them. Where a table here has the same name as one in `docs/ERD.md`, this set describes the *target* shape and `06` includes the migration.

## 1. Vision

Turn the twister page from "tap mic, get a number" into a **complete practice studio** with three ways to work on the same twister, from lowest-friction to highest-commitment:

1. **Read along** — no mic, no camera. The words move at a pace you choose; you speak (or just read) in rhythm. Great for beginners, quiet places, warm-ups, and people who are nervous about permissions.
2. **Speak & score** — the mic listens and tells you exactly *which words* you missed, lets you drill them, replay yourself, and watch your history climb.
3. **Record** — Loom-style video (camera, screen, or both) with the twister on screen, so you can review your delivery, share it, or keep a private progress diary.

The three modes share one **page shell**, one **settings model**, and one **results/history model**, so a user can move between them without losing context ("Read along at slow speed → Speak & score at the same speed → Record the final take").

## 2. Product principles

1. **Zero-friction first.** Every mode must be usable by a guest within 5 seconds. Accounts unlock *saving*, never *trying*.
2. **Ask for permissions late and explain why.** Mic and camera prompts appear only after the user taps a clearly-labelled action, with a one-line reason, and there is always a graceful non-permission alternative (Read along).
3. **Local-first for anything personal.** Audio and video stay on the device unless the user explicitly saves/shares. Uploads are opt-in, quota-limited, deletable.
4. **Honest feedback.** Scores must reflect what the user actually said. If the speech engine can't be trusted (noise, low confidence), say so instead of inventing a number.
5. **Never lose a take.** Recordings and attempts are persisted incrementally; a crash, reload, or lost connection must not destroy work.
6. **Progressive enhancement.** Detect capabilities (`getDisplayMedia`, `MediaRecorder`, `SpeechRecognition`, `speechSynthesis`); hide or replace what a browser can't do rather than showing broken buttons.
7. **Accessible and calm.** Keyboard-operable, screen-reader-labelled, reduced-motion respected, no flashing, captions on all recordings.
8. **Small, kind copy.** Encouraging, specific, never shaming ("You nailed 7 of 9 words — 'pickled' tripped you twice").

## 3. Learnings from the reference app (screenshots)

The four screenshots show a mobile tongue-twister app. We take *ideas*, not branding, layout, copy, or assets — all Twister UI is original.

| Reference feature | What we take | Where it lands |
|---|---|---|
| Home stats strip: Mastered `0/139`, Streak, Achievements `0/23` | A compact progress strip; "mastered" as a first-class concept | `05` §2–4 |
| Favorites · Random · Stats quick actions | Same three shortcuts on Home and Browse | `05` §5–7 |
| "Generate Twister — create a fresh tongue twister" | AI-generated twisters with safeguards | `05` §8 |
| "Try this twister!" featured card with level badge, best score | Already have the daily twister; add best score + favourite star | `05` §2 |
| Search + sort + difficulty tabs with counts (Easy 19 · Medium 63 · Hard 57 · All 139) | Counts on the level chips; sort menu | `05` §9 |
| **See Your Mistakes** — target text with wrong words in red, score %, "New Best Score!", duration, dot on a 0–100% axis, "My Voice" player with the transcript of what was heard (wrong words in red), Share / Retry / Continue | Word-level diff, own-voice playback with synced transcript, three clear next actions | `03` §5–6 |
| **Practice by Word** — one word highlighted, "Try to say this word…", play the word, big mic button | Drill mode for trouble words | `03` §7 |
| **Track Your Scores** — score history line chart with date/score/time table, best score, language flag, Train and Test buttons | History chart + table; Train vs Test split | `03` §8–9 |

Deliberate departures: (a) ours is web-first, so read-along and recording are new differentiators; (b) we keep scoring server-verified for signed-in users; (c) we add explicit privacy controls for voice/video.

## 4. Feature map

```
/twisters/:slug   (Practice Hub — page shell)
├── Header: title chip (difficulty, origin), favourite ★, share, settings ⚙, focus-sounds tags
├── Mode switcher:  [ Read along ]  [ Speak & score ]  [ Record ]
│
├── A. Read along   (02)   ── words move automatically, speed setting, threshold line
├── B. Speak & score (03)  ── mic check, mistakes view, train (by word) / test, voice playback, history
├── C. Record        (04)  ── layouts, camera/screen/mic setup, countdown, record, review, share
│      └── can host A or B live (Record + Read along; Record + Score)
└── Results & History (05) ── score ring, breakdown, delta, chart, attempts table, XP/streak/achievements
```

## 5. Phasing

| Phase | Theme | Ships | Gate to next phase |
|---|---|---|---|
| **P0** (done) | Foundation | Basic mic practice, live word highlight, auto-stop, server scoring | — |
| **P1** | Practice Hub + Read along | Mode switcher, preferences model, Read-along (word/line/scroll), speed control, TTS "listen first", keyboard/touch controls | ≥ 30% of sessions use Read along at least once; no P0 regressions |
| **P2** | Speak & Score v2 | Mic pre-flight, word-level diff, mistakes view, train-by-word, own-voice local playback, history chart, scoring v2 | Median "attempts per session" ≥ 2; scoring complaints < 2% of sessions |
| **P3** | Record (local-first) | Camera-only + camera-with-twister layouts, countdown, pause, local download, crash recovery, review page | Recording success rate ≥ 97% on Chrome/Edge/Safari |
| **P4** | Record (cloud) & sharing | Signed uploads, private/unlisted links, expiry, quotas, screen+cam layouts, transcoding worker | Storage cost/user within budget; zero P1 abuse reports unresolved |
| **P5** | Progress & delight | Mastery, achievements, stats page, favourites list, random, share cards, Generate Twister | Retention D7 ≥ 12% |

Each phase is independently shippable behind a feature flag (see `09`).

## 6. Cross-cutting requirements

### 6.1 Supported environments (support matrix)

| Capability | Chrome / Edge (desktop) | Safari (macOS) | Firefox | Chrome Android | Safari iOS |
|---|---|---|---|---|---|
| Read along | ✅ | ✅ | ✅ | ✅ | ✅ |
| Web Speech recognition | ✅ | ✅ (webkit-prefixed, some locales) | ❌ | ✅ | ⚠️ flaky; often needs Siri/dictation enabled |
| `getUserMedia` (mic/cam) | ✅ | ✅ | ✅ | ✅ | ✅ (user gesture + HTTPS) |
| `MediaRecorder` | ✅ (webm/vp9,vp8,opus) | ✅ 14.1+ (mp4/h264) | ✅ (webm) | ✅ | ✅ 14.3+ (mp4) |
| `getDisplayMedia` (screen) | ✅ | ✅ (desktop only) | ✅ | ❌ | ❌ |
| Element/region capture (`RestrictionTarget`/`CropTarget`) | ✅ Chromium only | ❌ | ❌ | ❌ | ❌ |
| `speechSynthesis` (model voice) | ✅ | ✅ | ✅ | ✅ | ✅ |

Rule: unsupported ⇒ **hide the option and show an inline "Not available on this browser — try Chrome on desktop" note**; never throw. The on-device engine (P2b, `10`) closes the Firefox/iOS gap for Speak & score because it does not need the browser speech API.

### 6.2 Privacy, consent & safety
- Voice/video are **personal data**. Default: processed in the browser and discarded. Saving audio or video to the cloud requires an explicit toggle plus a consent record (`06` → `UserConsent`).
- Web Speech in Chrome sends audio to Google to transcribe; disclose in the mic pre-flight ("Your browser's speech service listens to your voice to check your words") and in the privacy policy.
- Under-13 users: no cloud uploads, no public/unlisted sharing, no AI-generation until an age gate/parental consent flow exists. Age band captured at sign-up (`Profile.age_band`).
- Share links are unguessable (128-bit token), expiring, revocable, and never indexable (`noindex`, `X-Robots-Tag`).
- Right to erasure: "Delete my recordings" and "Delete my account" cascade to storage objects within 24 h; data export available.
- Abuse: report button on every shared recording; moderation queue (`ModerationReport`); takedown SLA 24 h.

### 6.3 Performance budgets
- Practice Hub route JS ≤ 180 KB gz on first load; Record mode code-split (dynamic import) and only loaded when the tab is opened.
- Read-along scheduler must hold ±30 ms timing accuracy over a 3-minute run (no cumulative drift).
- Visualizer/highlighter ≥ 55 fps on a 2019 mid-range laptop; recording canvas compositor ≥ 28 fps at 720p.
- Time to interactive for mode switch < 200 ms after first load.

### 6.4 Accessibility (WCAG 2.2 AA)
- All controls reachable by keyboard; visible focus rings; shortcut list in `?` dialog.
- Live regions announce state changes ("Listening", "Recording started", "Score 82").
- Never rely on colour alone for correct/near/wrong — add icon/underline/strike patterns.
- `prefers-reduced-motion`: replace smooth auto-scroll with stepwise highlight; disable confetti/pulses.
- Captions for all recordings; transcripts exportable.
- Text scaling to 200 % without loss; minimum tap target 44 px.

### 6.5 Analytics (privacy-respecting)
Event taxonomy is in `09`. No raw audio/video/transcripts in analytics. IDs are the Supabase user id (hashed for third-party tools).

### 6.6 Internationalisation
English only for v1 but all strings externalised; the twister table already supports future `language` column (`06`). Speech `lang` derived from user preference (en-US, en-GB, en-IN, en-AU) — this materially affects recognition accuracy.

## 7. Success metrics (feature-level)

| Metric | Target (90 days after P3) |
|---|---|
| Sessions using ≥ 2 modes | 25 % |
| Speak & score: attempts per session (median) | ≥ 2 |
| Mistakes-view → drill conversion | ≥ 20 % |
| Record: completion rate (start → saved/downloaded) | ≥ 60 % |
| Record: technical failure rate | < 3 % |
| Guest → sign-up after first scored attempt | ≥ 15 % |
| Support tickets per 1 000 sessions (permissions/audio) | < 5 |

## 8. Decisions (resolved — see `11-decisions-log.md`)
| # | Question | Decision |
|---|---|---|
| 1 | Free-tier cloud recording limits | 5 recordings · 3 min · 100 MB · 30 days from creation (D1) |
| 2 | Public gallery | No; unlisted share links only (D2) |
| 3 | Speech engine | Build in-house with open-source phoneme model + our own scoring; no third-party speech APIs (D3, `10`) |
| 4 | Read-along and streak/XP | Streak yes (≥ 1 pass, ≥ 30 s); XP 25 %, cap 50/day (D4) |
| 5 | Mastery threshold | ≥ 90 verified Test on 2 distinct days within 30 days (D5) |
| 6 | Minimum age | 13+ (D6) |
| 7 | Storage plan | Supabase Pro before enabling cloud recordings (D7) |

Still open (data-dependent, not doc-dependent): whether the phoneme model meets the accuracy targets on Indian-English speakers, model size after export, and whether a Pro plan is worth building.
