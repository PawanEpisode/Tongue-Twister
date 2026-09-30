# PRD 02 — Read Along Mode (no audio check)

**Summary:** The twister's words are presented automatically — word-by-word, line-by-line, or as a smooth teleprompter scroll — at a speed the user controls. No microphone is used or requested. The user reads/speaks along at their own pace.

## 1. Why
- Lowest-friction way to practise: no permissions, works in a library or on a train, works in Firefox.
- Teaches **pacing** — the thing most people get wrong on twisters (they rush and blur).
- A stepping stone: slow → fast (speed ladder) then graduate to Speak & score.
- Also the engine for the teleprompter inside Record mode (04), so it must be reusable as a headless module.

## 2. User stories
1. *As a beginner*, I want the words to highlight one by one slowly so I can follow without pressure.
2. *As a practiser*, I want to increase the speed gradually so I build up to full speed safely.
3. *As a presenter*, I want a teleprompter-style scroll with a reading line so I can practise while looking near the camera.
4. *As a user with dyslexia / low vision*, I want bigger text, a different font, and control over motion.
5. *As a user in a noisy/quiet place*, I want to practise without the mic.
6. *As a learner*, I want to hear a model reading first, then read along.

## 3. Display styles

| Style | Behaviour | Best for |
|---|---|---|
| **Word-by-word** (karaoke) | Whole twister visible; the *current word* is highlighted, past words dim to "done" colour, upcoming stay neutral. View auto-scrolls to keep the current word at the threshold line. | Short/medium twisters, beginners |
| **Line-by-line** | Text is split into lines (by sentence, then by max ~6–8 words / container width). Current line is emphasised and centred on the threshold line; previous lines fade; next 1–2 lines faintly visible. | Long/marathon twisters |
| **Continuous scroll** | Classic teleprompter: text moves upward at constant speed; words crossing the threshold line are "current". No per-word highlight by default (optional). | Recording with camera, presenters |

Style is a per-user preference and can be switched mid-session without losing position (position is stored as a word index).

## 4. Controls & settings

**Transport:** ▶ Start / ⏸ Pause / ⏹ Restart · ⏪ back one line · ⏩ forward one line · drag/scrub the progress bar · loop counter.
**Speed:** slider 40–300 WPM + presets **Slow (70) · Normal (110) · Fast (150) · Pro (190)** + fine ± buttons (±5). Default by difficulty: Easy 90 · Medium 110 · Hard 130 · Insane 150.
**Speed ladder (optional toggle):** after each completed loop, +10 WPM up to a target ("Build up to 160 WPM"). A ladder progress chip shows the next speed.
**Threshold line:** horizontal guide with a soft gradient mask above/below; position 20–60 % (default 35 %); can be hidden.
**Typography:** font scale 0.8–2.0×, line height, letter spacing, optional dyslexia-friendly font, high-contrast highlight, mirror (flip horizontally for glass teleprompters).
**Audio helpers:** "Listen first" (browser TTS reads the twister at the selected WPM, highlighting in sync); optional metronome tick per word or per beat (Web Audio, tiny synthesized click, volume slider).
**Countdown:** 3-2-1 (configurable 0–5 s) before start and after each loop restart.
**Loop:** 1–10 or ∞ with a short pause (0–3 s) between loops.

**Keyboard:** `Space` play/pause · `R` restart · `←/→` back/forward one word (line in line-mode) · `↑/↓` speed ±5 · `[` `]` font size · `L` listen-first · `F` fullscreen · `M` mirror · `?` help.
**Touch:** tap stage = play/pause; two-finger pinch = font size (optional); swipe up/down on the progress bar = seek; long-press a word = "start from here".

## 5. Timing model (how "speed" works)

Naïvely dividing WPM evenly makes long words feel too fast and short words too slow. Build a **timeline** once per (text, settings):

```
base_ms_per_word  = 60_000 / WPM
weight(word)      = clamp(0.6 + 0.12 * syllables(word) + 0.02 * max(0, len(word) - 5), 0.7, 2.0)
pause_after(word) = base_ms * { ',': 0.35, ';': 0.45, ':': 0.45, '.': 0.7, '?': 0.7, '!': 0.7, '—': 0.3 }   (if "Punctuation pauses" on)
duration(word)    = base_ms_per_word * weight(word) / mean(weights)   // keeps average = chosen WPM
start_ms[i]       = Σ (duration + pause_after) for j < i
```
- Syllable count via a small heuristic (vowel-group counting with silent-e rule); good enough for pacing, not for linguistics.
- The effective WPM is **displayed** as the user's chosen number; the actual instantaneous rate varies by word weight.
- **Line mode** aggregates word starts per line and eases the scroll between lines (`easeInOutCubic`, 250 ms; instant when reduced motion).
- **Continuous scroll** uses pixel velocity = total_scroll_distance / total_timeline_ms so that the *reading line* meets each word at its `start_ms`.

**Scheduler:** a single `requestAnimationFrame` loop reads `performance.now()`, computes `t = now − t0 − pausedTotal`, and sets the current index by binary search on `start_ms[]`. No `setInterval` chains ⇒ no drift. State updates happen only when the index changes (not every frame) to avoid React re-render storms; the scroll transform is applied imperatively.

**Page hidden:** on `visibilitychange → hidden`, auto-pause and show "Paused because you switched tabs" (except in Record mode where the tab must stay visible, see 04).
**Speed change mid-run:** timeline is rebuilt and `t` is re-mapped so the *current word stays current* (no jump).

## 6. Completion & feedback (no score)
- After the last word: "✅ Nicely paced." with stats — duration, effective WPM, loops done.
- CTA row: **Faster (+10 WPM)** · **Again** · **Try Speak & score** · **Record it**.
- Read-along has no accuracy score by design. It can award **practice minutes** and progress the **streak** (≥ 1 full pass) and gives reduced XP (25 % of a scored attempt, cap 50 XP/day) so it can't be farmed.
- Session logged as `PracticeSession(mode=read_along)` with settings snapshot, loops, active_ms (see 06).

## 7. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| R1 | Three display styles with live switching | P0 |
| R2 | WPM control 40–300 with presets, persisted | P0 |
| R3 | Threshold line with adjustable position; current word/line always aligned to it | P0 |
| R4 | Play / pause / restart / seek by word or line | P0 |
| R5 | Countdown and loop options | P1 |
| R6 | Speed ladder | P1 |
| R7 | Listen-first TTS synced highlight | P1 |
| R8 | Punctuation-aware timing | P1 |
| R9 | Font/contrast/dyslexia/mirror options | P1 |
| R10 | Keyboard + touch controls, `?` help | P1 |
| R11 | Metronome/click | P2 |
| R12 | Headless engine export for Record mode teleprompter | P1 |
| R13 | Fullscreen ("Focus mode") hides all chrome except stage + minimal controls | P2 |

## 8. Edge cases & decisions

| # | Case | Behaviour |
|---|---|---|
| 1 | Very short twister (≤ 4 words) | Auto-loop ×3 with 1 s gap; completion after final loop |
| 2 | Very long (100–200 words) | Show estimated total time before start; default to Line-by-line; provide "Jump to sentence" list; keep current line ≥ 2 lines from container bottom |
| 3 | WPM extremes | Clamp to 40–300; below 40 warn "Very slow"; above 250 show "Faster than most humans can speak clearly" (soft, non-blocking) |
| 4 | Browser tab throttled/hidden | Auto-pause (unless Record). On return, resume with a 1-2-3 mini countdown |
| 5 | Window resize / rotate mid-run | Recompute line breaks; keep same word index current; no visual jump > 1 line |
| 6 | Font scale change mid-run | Same as resize |
| 7 | Text contains hyphens, apostrophes, numerals, emoji | Tokenise by whitespace for display; timing weight uses cleaned token; emoji/punctuation-only tokens get 0.5× weight |
| 8 | TTS unavailable / no English voice | Hide Listen first; show tooltip explaining why |
| 9 | TTS rate mismatch | Web Speech `rate` maps approx. 1.0 = 170 WPM; compute `rate = clamp(WPM/170, 0.5, 2)`; highlight follows `onboundary` word events when supported, else falls back to the timeline |
| 10 | Screen reader users | Do not announce every word. Announce start, loop completion, and end; provide a "Read full text" static block |
| 11 | Reduced motion | No smooth scroll/pulse; highlight steps instantly; ladder toasts instead of animation |
| 12 | Audio autoplay policy for metronome/TTS | Only start audio in response to the Start tap; if suspended, show "Tap to enable sound" |
| 13 | Two Start taps in quick succession | Idempotent: second tap ignored while starting |
| 14 | Pause during countdown | Cancels the countdown; Start restarts it |
| 15 | User changes twister via Next during a run | Confirm only if elapsed > 10 s; otherwise switch immediately |
| 16 | Clock/perf.now jumps (sleep/wake) | Detect `dt > 1000 ms` between frames → treat as pause |
| 17 | Low-end devices | Drop to word-step (no smooth scroll) if frame time > 32 ms for 1 s; toast "Smooth scroll turned off to keep up" |
| 18 | Guest state | Everything works; session stored locally; sync after sign-in |

## 9. Acceptance criteria (excerpt)
- Given WPM = 120 and a 60-word twister without pauses, when the run completes uninterrupted, then total time is 30 s ± 0.3 s.
- Given the user changes WPM from 100 to 140 at word 12, then word 12 remains current and subsequent timing reflects 140 WPM.
- Given Line-by-line and a container resize, then no word is skipped or repeated.
- Given `prefers-reduced-motion`, then no CSS transition longer than 0 ms is applied to text movement.
- Given the tab is hidden for 20 s, then the run is paused on return and resumes only after user action + mini countdown.

## 10. Telemetry
`readalong_start {style, wpm, words, loops}` · `readalong_speed_change {from,to,source:slider|preset|ladder|keyboard}` · `readalong_complete {duration_ms, loops, avg_wpm}` · `readalong_abandon {at_pct}` · `readalong_listen_first_used`.
