# Twister — Product Requirements Document

**Status:** v0.1 (MVP) · **Owner:** Pawan · **Last updated:** 2026-09-29

## 1. Vision
Make practising tongue twisters as addictive and delightful as a mobile game. Users speak into their mic, watch each word light up in real time, and get an instant score they want to beat. Start with a great library of classic and modern twisters across four difficulty levels; grow into a full speech-play platform (challenges, social, coaching).

## 2. Problem & opportunity
- Existing tongue-twister sites are static lists — no feedback, no progression, no reason to return.
- Speech-clarity practice (public speakers, actors, ESL learners, kids, speech therapy adjacents) lacks a fun, low-friction tool.
- Browser speech recognition is now good and free, so real-time feedback needs no paid ML.

## 3. Target users
| Persona | Need | Hook |
|---|---|---|
| Casual player | Quick fun, shareable scores | Daily twister, instant score |
| Language learner | Pronunciation drills by sound | Sound-family categories, tips |
| Speaker / presenter | Warm-up routine | Streaks, levels, favourites |
| Parent / teacher (later) | Kid-safe practice | Easy level, classroom mode (post-MVP) |

## 4. Goals & success metrics (first 90 days)
- **Aha rate:** ≥ 60% of new visitors complete one attempt in their first session.
- **Time to first attempt:** < 30 s from landing (no signup required — guest mode).
- **D1 / D7 retention:** ≥ 25% / 10%.
- **Sign-up conversion from guests who finish an attempt:** ≥ 15%.
- Median API p95 latency < 400 ms; Lighthouse performance ≥ 90 on mobile.

## 5. The "Aha" moment
Tap the mic → say the twister → **every word turns green live as you nail it** → score ring fills, confetti fires, XP and streak tick up. The delight is the *live word-by-word feedback* and the *instant animated payoff*. Guests get this with zero signup.

## 6. Scope

### 6.1 MVP (this repo)
1. **Twister library** — 44 seeded classics + modern originals; 4 difficulty levels (Easy/Medium/Hard/Insane); 6 sound-family categories; classic vs modern origin; coaching tip per twister.
2. **Browse & search** — filter by level, category, origin; free-text search.
3. **Practice screen** — live speech recognition (Web Speech API), live word highlighting, typed fallback for unsupported browsers.
4. **Scoring** — accuracy (order-aware word match) + speed (words/min vs. level reference) → 0–100 score. Server is source of truth for signed-in users; client mirrors it for guests.
5. **Result payoff** — animated score ring, confetti (≥ 80), Lottie success badge, personal-best and level-up callouts.
6. **Accounts** — Supabase Auth (email/password + Google). Profile auto-created on first API call.
7. **Progression** — XP, levels (200 XP each), daily streak.
8. **Daily twister** — deterministic rotation, same for everyone.
9. **Favourites & per-twister leaderboard** (API ready; UI post-MVP).
10. **Admin** — Django admin to add/edit twisters and categories.

### 6.2 Post-MVP roadmap
| Phase | Features |
|---|---|
| 1.1 | Favourites & leaderboard UI, profile page, avatar picker, share-your-score image card |
| 1.2 | Phoneme-level feedback (which sound tripped you), slow-mo audio model of each twister (TTS) |
| 1.3 | Daily challenge with global rank, weekly tournaments, friend challenges via link |
| 2.0 | User-submitted twisters + moderation, kids mode, multi-language, streak freezes, push/email reminders |
| 2.x | Premium: advanced analytics, custom practice plans, coach/classroom dashboards |

### 6.3 Out of scope (MVP)
Audio recording/storage, payments, native apps, moderation tooling, non-English recognition.

## 7. Functional requirements (MVP)
| ID | Requirement | Priority |
|---|---|---|
| F1 | Anyone can browse/practise without an account | P0 |
| F2 | Filter library by difficulty, category, origin; search text | P0 |
| F3 | Live transcription with word-level highlighting | P0 |
| F4 | Score computed from accuracy + speed; shown with animation | P0 |
| F5 | Signed-in attempts persisted; XP/level/streak updated atomically | P0 |
| F6 | Daily twister endpoint & home-page feature | P1 |
| F7 | Auth via Supabase (email + Google) | P0 |
| F8 | Admin CRUD for content | P1 |
| F9 | Favourite toggle; per-twister top-10 | P2 (API only) |

## 8. Non-functional requirements
- **Performance:** SSR shell via TanStack Start; API p95 < 400 ms; static assets on Vercel CDN.
- **Accessibility:** WCAG AA contrast, keyboard operable, `prefers-reduced-motion` honoured, typed fallback when no mic.
- **Privacy:** audio never leaves the browser (speech recognition is on-device/browser-vendor); only the text transcript is sent. Note: Chrome's implementation may send audio to Google's service — disclose in privacy policy.
- **Security:** JWT verified server-side (JWKS/HS256), CORS allow-list, throttling, no secrets in client, Django admin restricted to staff.
- **Reliability:** idempotent seed, DB migrations in CI, health endpoint `/api/health/`.
- **Cost:** run entirely on free tiers (Supabase Free, Vercel Hobby) until traction.

## 9. Scoring model
```
accuracy = (words matched in order − 0.25 × extra words) / target words      (0..1)
speed    = min(1, wpm / reference_wpm[level])   only if accuracy ≥ 0.6
score    = round(accuracy × 70 + speed × 30)
xp       = round(score/4) + 3 × level + (10 if accuracy ≥ 0.98)
reference_wpm = {Easy 110, Medium 130, Hard 150, Insane 170}
```

## 10. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Web Speech API unsupported (Firefox) | Typed fallback now; server-side STT (Whisper/Deepgram) in phase 1.2 |
| Recognition auto-corrects twisters, inflating scores | Track per-word confidence; add phoneme scoring later |
| Leaderboard cheating via forged transcripts | Server scoring + rate limits; add audio-based verification in phase 2 |
| Serverless Django cold starts | Keep deps small; move to always-on host (Render/Fly) if p95 suffers |
| Content copyright | Only traditional/public-domain classics + original modern lines |

## 11. Open questions
- Monetisation path (ads vs. premium vs. B2B classroom)?
- Kids-mode and COPPA/GDPR-K implications before marketing to under-13s.
- Which languages after English?
