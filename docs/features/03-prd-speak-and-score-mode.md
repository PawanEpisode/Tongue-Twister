# PRD 03 — Speak & Score Mode (audio check, improved)

**Summary:** The mic checks what the user says against the twister. This upgrades today's flow with a **pre-flight mic check**, **word-level results** (the "See your mistakes" view), **Train** (drill by word/chunk) vs **Test** (scored, counts towards mastery), **own-voice playback**, **score history**, and a more honest **scoring v2**.

## 1. Problems with today's flow
1. First words get lost because recognition starts late → *(mitigated: arming/GO! — keep, and add mic pre-flight so users trust the "GO")*.
2. A single number gives no guidance about *what* to fix.
3. Browser recognisers "auto-correct" twisters toward normal English, which inflates scores.
4. No way to hear yourself, drill one word, or see progress.
5. Accents, noise, and permissions are not handled explicitly.

## 2. User stories
1. As a learner I want to see **which words** I missed, so I can practise those.
2. As a learner I want to **drill a single word** with a model pronunciation and retry until it's right.
3. As a competitor I want a **Test** attempt that counts (and can't be gamed) vs a relaxed **Train** mode.
4. As a user I want to **hear my own voice** next to what the app heard.
5. As a returning user I want to see my **score history** for this twister.
6. As a user with a strong accent I want to pick my **accent/language model**.

## 3. Pre-flight mic check (first entry per session, skippable after success)
1. **Support check** — `SpeechRecognition` present? If not → explain + offer Read along (and, once shipped, the on-device or worker engine fallback).
2. **Permission** — request only after the user taps "Enable microphone". Shows one-line reason + privacy note.
3. **Device pick** — if > 1 input device, dropdown ("MacBook Microphone", "AirPods"); remember by `deviceId` locally.
4. **Level test** — "Say *hello* to test your mic": live meter; pass when peak > −35 dBFS for 300 ms; warns on clipping (> −1 dBFS) and on too quiet.
5. **Noise check** — 1 s room-tone sample; if noise floor > −45 dBFS show "It's quite noisy here — headphones or a quieter spot will improve accuracy" (non-blocking).
6. **Ready** — "All set" and a **Start** button that leads to the arming → **GO!** sequence (already built).

Pre-flight result is cached for the session; re-run automatically if the device changes or an audio error occurs.

## 4. Practice types

### 4.1 Test (scored)
- Say the whole twister once. Auto-stop (all words matched, or silence 2.8 s / 4.5 s long).
- Produces a scored `Attempt(kind=test)` that updates best score, streak, XP, mastery, achievements.
- One take per attempt; **Retry** creates a new attempt (the previous stays in history).

### 4.2 Train (learning, forgiving)
- Twister is split into **chunks** (3–5 words, by punctuation first, then length). The user must pass a chunk (≥ 85 % word-accuracy) before it unlocks the next; chunks can be looped.
- After all chunks: a **stitching round** (two chunks together), then a full-twister pass.
- Optional "Listen first" TTS for each chunk (uses the same engine as Read along 02 §4).
- Train attempts are stored (`kind=train`) but **do not** affect best score/mastery; they award small XP and count for streak.

### 4.3 Very short twisters (≤ 4 words)
One attempt = say it **3 times in a row** (repeat counter shown); the score is the average with a consistency bonus.

### 4.4 Word drill ("Practice by word")
- Entry points: tap any red/amber word in the mistakes view; or "Drill my 3 weakest words".
- Screen shows: the sentence with the target word highlighted; the word large; a 🔊 button (TTS, plus slowed 0.6× option); phonetic hint (respelling like "PEK-uhld" — sourced from a small pronunciation table, falls back to none); the mic button.
- Pass criteria: recognised as the target word (or `near`) at confidence ≥ 0.6 → green tick → next weak word. Three misses ⇒ "Take a breath — try saying it slowly" with 0.6× TTS auto-played. Skip allowed.

## 5. Results — "See your mistakes"

### 5.1 Word-level diff
Align spoken words to target words with a dynamic-programming alignment (Needleman–Wunsch on tokens, cost: exact 0, near 0.3, substitute 1, insert/delete 1). Each **target** word gets a status; extra spoken words are shown as **inserted** chips.

| Status | Meaning | Visual (colour + non-colour cue) |
|---|---|---|
| ✅ Correct | Exact match (after normalisation) | Green text |
| 🟡 Near | Phonetically similar (Double-Metaphone equal or edit distance ≤ 1 on ≥ 4 letters), e.g. *peck/pack*, *sells/cells* | Amber + dotted underline |
| ❌ Wrong | Different word spoken in that slot | Red + solid underline; shows what we heard in a tooltip/second line |
| ⭕ Missed | No spoken word aligned | Red + strikethrough |
| ➕ Extra | Spoken word not in target (repetition, filler, stutter) | Grey chip between words |

Header shows: **score %**, message ("Keep practising!", "Nice!", "Tongue Titan!"), **"New best!"** badge, duration, effective WPM.
Below: **"What we heard"** — the recognised transcript with wrong words in red (mirrors the reference "My Voice" caption).

### 5.2 Own-voice playback
- Opt-in "Save my voice for playback" (default **off**). When on, the raw mic stream is recorded locally (`MediaRecorder`, opus/webm or mp4/aac on Safari) for the attempt only.
- Player: play/pause, scrub, 0.5×/1×/1.5× speed, waveform (wavesurfer-style), and **karaoke sync** — the "What we heard" text highlights as audio plays (word timings from the engine alignment in P2b; approximated from recognition timestamps in P2a).
- Stored **only in browser memory / IndexedDB** for the last N=5 attempts (auto-evicted), unless the user taps **Save to cloud** (quota + consent, same pipeline as Record 04 §10).

### 5.3 Actions
`Retry` (same twister, new attempt) · `Drill weak words` · `Continue` (next twister at same level, or "try one level up" if score ≥ 90) · `Share` (score card) · `Record it` (jump to Record mode with this twister).

## 6. Scoring v2

```
per-word credit:  correct = 1.0 · near = 0.6 · wrong = 0 · missed = 0 · extra = −0.15 (cap −0.5 total)
accuracy (0–1)  = max(0, Σ credit / target_words)

speed (0–1)     = clamp(effective_wpm / reference_wpm(level), 0, 1)     (only if accuracy ≥ 0.6)
     reference_wpm: Easy 110 · Medium 130 · Hard 150 · Insane 170 · Marathon 140

fluency (0–1)   = 1 − clamp(long_pause_ms / (0.35 · speaking_ms), 0, 1)     (pauses > 700 ms inside the utterance)

score           = round(100 · (0.70·accuracy + 0.20·speed + 0.10·fluency))
```
- Previous formula (70 accuracy / 30 speed) is superseded; **historic attempts keep their stored score** (`score_version` column, see 06).
- **Confidence gating:** if mean engine confidence < 0.45 (or the quality gate in `10` §4.9 fails), or > 40 % of words are `near/wrong` while the audio level was very low, show **"We couldn't hear you clearly"** and offer a retry *without* saving a score.
- **Anti-cheat (server):** reject/flag attempts with duration implausible for word count (> 320 WPM), identical transcript spam, or > 30 attempts/10 min. Guest scores are never ranked.
- **Mastery:** `best Test score ≥ 90` on **two different calendar days** (user timezone) within 30 days. Constant configurable (`MASTERY_MIN_SCORE`, `MASTERY_MIN_DAYS`).

### 6.1 Normalisation rules (both client & server share one spec + shared test vectors)
Lowercase; strip punctuation except inner apostrophes; expand numerals ("2" ↔ "two"); normalise hyphenated compounds ("woodchuck-wood"); drop fillers (*um, uh, er, hmm*); collapse immediate repeats **only** if the target repeats the word; map common recogniser artefacts ("gonna" ≠ "going to" — treated as *near*); British/American spelling equivalents (*colour/color*); homophones list (*there/their*) counted `near`.

## 7. Speech engine strategy (decided — design in `10`, decisions `11` D3/D8/D10)

| Tier | Engine | Notes |
|---|---|---|
| 0 (now, P2a) | Browser Web Speech text layer + our lexicon and phoneme-aware comparison | Free, no model. `provisional` practice score. Fixes homophones; focus swaps are `wrong`. Text layer optional / off in private mode |
| 1 (P2b) | **On-device engine**: open-source phoneme CTC model (ONNX, Web Worker) + our alignment, substitution tests, GOP features and verdicts | Opt-in "Accurate mode"; audio stays on the device; `device` trust level |
| 2 (P2b–c) | **Worker engine** (same algorithm, Python container) | Spot-checks ~10 % of Test attempts and every would-be personal best ≥ 90; serves devices that cannot run Tier 1; `verified` |
| 3 (P5) | Our own small distilled model | R&D |
| Rejected | Paid/third-party speech APIs | Product decision D3 |

Gate: Accurate mode is enabled only after the calibration targets in `10` §7 are met (focus-swap recall ≥ 85 %, false accusation ≤ 5 %).

Interface: `SpeechEngine { start(), stop(), onInterim(text), onFinal(result), capabilities }` so engines are swappable and testable with recorded fixtures.

Mitigating auto-correct in P2a: request `maxAlternatives = 3` and prefer the alternative closest to the target only for `near` credit (never full credit); log discrepancies to tune thresholds.

## 8. History & progress on this page
- **Best score**, **attempts**, **last 5 scores** sparkline in side panel.
- **Score History** view (modal or tab): line chart (0–100 %), toggle 10 / 30 / all; colour bands (≥ 90 green, 60–89 amber, < 60 red); table with Date · Score · Time · Mode(Test/Train) · ▶ (voice playback if stored). Tap a row → reopen that attempt's mistakes view (word statuses are persisted, `AttemptWord`).
- Empty state: "No attempts yet — your first score will show up here."

## 9. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| S1 | Pre-flight (support, permission, device, level, noise) | P0 |
| S2 | Arming → GO! → listening (built) + explicit "Retry mic" on failure | P0 |
| S3 | Word-level alignment & statuses (client for guests, server for signed-in) | P0 |
| S4 | Mistakes view with 5 statuses, "what we heard", actions | P0 |
| S5 | Test vs Train; chunking; stitching | P1 |
| S6 | Word drill with TTS + phonetic hint | P1 |
| S7 | Own-voice local playback with sync | P1 |
| S8 | Score history chart + table; persisted `AttemptWord` | P1 |
| S9 | Scoring v2 with confidence gating, `score_version` | P0 |
| S10 | Accent/language selector | P1 |
| S11 | Device/worker engine scoring (`10`) + fallback for Firefox/iOS | P2 |
| S12 | Offline attempts queue with idempotent sync | P1 |
| S13 | Anti-cheat and rate limiting | P1 |

## 10. Edge cases

| # | Case | Behaviour |
|---|---|---|
| 1 | Mic permission denied / revoked mid-session | Stop; show fix steps; keep transcript; offer Read along |
| 2 | No speech detected for 6 s after GO | Prompt "Didn't catch anything — check your mic" with level meter; auto-stop at 12 s |
| 3 | User starts speaking before GO | Audio between arming and GO is buffered by the level meter only; we start timing at first recognised word; show tip "Wait for GO next time" after 2 occurrences |
| 4 | Recognition session ends unexpectedly (Chrome ~60 s / silence) | Auto-restart, accumulate transcript (built); cap 5 restarts then stop with message |
| 5 | Background noise / other voices | Confidence gate; suggestion to use headphones; never punish silently |
| 6 | Accent mismatch | Show accent selector after two low-confidence attempts ("Try en-GB?") |
| 7 | Homophones / near words | `near` credit; details visible; no red shaming for recogniser quirks |
| 8 | User says extra words / restarts mid-way | Extras penalised lightly; "Start over" button discards without scoring |
| 9 | User finishes far faster than physically plausible | Server flags; local result shown, not saved to leaderboards |
| 10 | Very long twisters | Chunk-based Train recommended; Test allowed; silence tolerance raised; progress bar |
| 11 | Two tabs | Session lock prevents double capture |
| 12 | Bluetooth headset switching (AirPods connect mid-run) | `devicechange` event → pause, re-run level test, resume |
| 13 | Screen locks / app backgrounded on mobile | Stop listening, save partial transcript, show "Paused" |
| 14 | Guest → sign-in after a great score | Keep result in memory; after sign-in, submit with `client_attempt_id` so it is saved once |
| 15 | Network drop when submitting | Local score shown immediately; queued; sync badge "Saved offline" |
| 16 | Duplicate submissions (double-tap, retry) | Idempotency via `client_attempt_id` unique per user |
| 17 | Recogniser returns nothing / quality gate fails | Treated as "couldn't hear you", not a zero score |
| 18 | Twister contains a name/rare word (e.g., "Theophilus") | Add pronunciation hints & alternates in `Twister.pronunciations` (06) to avoid false misses |
| 19 | Low-vision / screen reader | Results summarised in text ("7 of 9 words correct. Missed: pickled, peppers"), not just colour |
| 20 | Kids/quiet voices | Auto-gain on; gentler "couldn't hear" thresholds; no ranking |

## 11. Acceptance criteria (excerpt)
- Given target "Peter Piper picked a peck" and spoken "peter piper picked up pickle", then statuses are correct, correct, correct, **wrong**(a→up)… and an alignment that never assigns one spoken word to two targets.
- Given mean confidence 0.3, then no score is saved and the user sees the retry message.
- Given a Test attempt with score 92 on day 1 and 91 on day 3, then the twister becomes Mastered on day 3.
- Given the same `client_attempt_id` posted twice, then exactly one attempt exists and both responses are 200 with the same body.
- Given "Save my voice" off, then no audio bytes are written to IndexedDB or uploaded.

## 12. Telemetry
`speak_preflight {result, device_count, noise_db, level_db}` · `speak_start {kind, engine, lang}` · `speak_result {score, accuracy, speed, fluency, words:{correct,near,wrong,missed,extra}, confidence, engine}` · `speak_low_confidence` · `drill_start/pass/skip {word}` · `history_open` · `voice_playback_play`.
