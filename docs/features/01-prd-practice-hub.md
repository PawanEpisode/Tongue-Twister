# PRD 01 — Practice Hub (the twister page shell)

**Route:** `/twisters/:slug` · **Depends on:** existing twister API · **Enables:** 02, 03, 04

## 1. Problem
Today the twister page is a single flow (tap mic → score). To add Read-along, richer scoring and Recording without three separate pages, we need a **shell** that owns: the twister text, the mode switcher, shared settings, permission state, and the results/history area.

## 2. Goals / non-goals
**Goals:** one URL per twister; instant mode switching; settings that persist and follow the user; a consistent permission story; deep-linkable state (`?mode=read&wpm=110`); clean teardown between modes (no orphan mic/camera streams).
**Non-goals:** a separate route per mode; a lesson/course system; multiplayer.

## 3. Layout

### 3.1 Desktop (≥ 1024 px)
```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Browse   [Easy] classic · 38 words         ♡ Fav   ⤴ Share   ⚙ Settings │
├──────────────────────────────────────────────────────────────────────────┤
│         ( Read along )  ( Speak & score )  ( Record )   ← segmented control│
├───────────────────────────────────────────────┬──────────────────────────┤
│                                               │  Best  82   Attempts 6   │
│            STAGE (mode-specific)              │  ───── mini history ──── │
│                                               │  Tips: "Keep W rounded"  │
│                                               │  Focus sounds: w · ch    │
├───────────────────────────────────────────────┴──────────────────────────┤
│  Control bar (mode-specific: play/pause · speed · mic · record · restart)   │
└──────────────────────────────────────────────────────────────────────────┘
```
### 3.2 Mobile (< 640 px)
Single column. Mode switcher becomes a bottom tab bar (thumb reach). Side panel collapses into a "Best 82 · 6 attempts ▾" sheet. Control bar is sticky above the safe-area inset. Settings open as a bottom sheet.

## 4. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| H1 | Mode switcher with three modes; last-used mode remembered per user (and per device for guests) | P0 |
| H2 | Deep links: `?mode=read|speak|record`, `&wpm=`, `&style=`; invalid values fall back to defaults silently | P0 |
| H3 | Switching modes stops any active session (recognition, recording, timers) and releases devices within 300 ms; unsaved take triggers a confirm | P0 |
| H4 | Shared **Settings drawer** with sections per mode; all changes apply live and persist (see §6) | P0 |
| H5 | Side panel shows best score, attempt count, focus sounds, tip, mini sparkline; hidden when no data (guest first visit) | P1 |
| H6 | Favourite toggle (guest → prompts sign-in inline, keeps the click intent) | P1 |
| H7 | Share button: copies canonical URL; native share sheet on mobile; optional score card (Phase 5) | P1 |
| H8 | Keyboard shortcut layer with `?` help dialog; shortcuts never fire while typing in inputs | P1 |
| H9 | Skeleton + error states for every async region (twister, history, prefs) | P0 |
| H10 | Long twisters (> 30 words) use a scrollable stage with a fixed threshold line; short ones are centred | P0 |
| H11 | "Next / Previous twister" within the same level or filter context (context passed via router state; falls back to random same-level) | P1 |
| H12 | Page title/OG tags per twister (already implemented) remain server-rendered | P0 |

## 5. Mode switching behaviour

| From → To | Behaviour |
|---|---|
| Any → Read along | Stop mic/camera streams. Keep last speed. Do not auto-play; show "Start" with countdown. |
| Any → Speak & score | Run **pre-flight** (see 03 §3) on first entry per session. Keep speed only as an optional pacing hint. |
| Any → Record | Load Record bundle (dynamic import). Show setup screen; never auto-request camera until user taps "Enable camera". |
| Record (active) → other | Block with dialog: *Stop and save this take? / Discard / Keep recording*. |
| Speak (listening) → other | Stop listening; if transcript has ≥ 3 words, offer "Score what you said?" toast for 5 s. |

State that **persists across modes:** twister, speed (WPM), font scale, accent/language, theme. State that **resets:** transcript, current word index, elapsed time, countdown.

## 6. Settings model

Stored in `UserPreference` (signed in) and `localStorage` (guest/offline); server wins on conflict by `updated_at`. Guest settings migrate to the account on first sign-in (merge, not overwrite).

| Group | Setting | Values / default |
|---|---|---|
| General | Default mode | read / speak / record — last used |
| General | Accent (speech `lang`) | en-US · en-GB · en-IN · en-AU — from `navigator.language` |
| Reading | Display style | Word-by-word · Line-by-line · Continuous scroll — Word-by-word |
| Reading | Speed (WPM) | 40–300, step 5 — by difficulty (90/110/130/150) |
| Reading | Threshold line position | 20–60 % from top — 35 % |
| Reading | Font scale | 0.8–2.0 — 1.0 |
| Reading | Mirror text | off |
| Reading | Loop count | 1–10 or ∞ — 1 |
| Reading | Punctuation pauses | on |
| Reading | Click/metronome | off |
| Speak | Auto-stop after silence | on (2.8 s; 4.5 s for long) |
| Speak | Save my voice for playback | **Off** (local only when on) |
| Speak | Show live transcript | on |
| Record | Default layout | Camera + text |
| Record | Resolution | 720p (1080p on capable devices) |
| Record | Mirror preview | on |
| Record | Countdown | 3 s |
| Accessibility | Reduce motion | follows OS |
| Accessibility | High-contrast highlight, dyslexia-friendly font | off |

## 7. Permission model (shared)

One `useMediaPermissions()` hook exposes, for `microphone` and `camera` separately:
`unknown → prompt → granted | denied | unavailable | in_use | error` and `requestAccess()`.
- Use the Permissions API where available; fall back to trying `getUserMedia` (Safari doesn't expose camera/mic permission state).
- **Denied** state UI: plain-language steps with browser-specific images/links ("Click the 🔒 in the address bar → Site settings → Microphone → Allow"), plus a "Try again" button and the **Read along** alternative.
- **In use** (NotReadableError): "Another app is using your camera. Close it and retry."
- **Unavailable** (NotFoundError): "No microphone found. Plug one in or use Read along."
- Never prompt on page load. Never re-prompt in a loop; after two denials, stop asking and show settings help.

## 8. Edge cases (shell-level)
1. Twister unpublished/deleted while page open → next API call 404 → "This twister was removed" with Browse CTA.
2. User opens the page in two tabs → second tab shows "Practice is active in another tab" if a session lock (`BroadcastChannel`) is held; prevents double mic capture and duplicate attempts.
3. Slow/failed prefs fetch → render with local prefs, retry silently, never block practice.
4. Sign-in mid-session (OAuth redirect) → session snapshot saved to `sessionStorage` and restored after return (mode, speed, unsaved transcript).
5. Offline: Read along and local recording keep working; scoring for guests is local; attempts queue in IndexedDB and sync (idempotent by `client_attempt_id`).
6. Browser back during recording → `beforeunload` + router blocker; never silently discard.
7. Screen readers: mode switcher is a `tablist`; stage region is `aria-live="polite"` with throttled announcements (no per-word chatter).
8. Extremely short twisters (≤ 4 words) → Read along defaults to loop 3; Speak & score uses "repeat ×3 for one score" variant (see 03 §4.3).
9. Extremely long twisters (100–200 words) → estimated duration shown before starting ("~1 min 20 s at 110 WPM"); Record mode warns if estimated length exceeds the per-recording limit.
10. Unsupported browser for the *only* mode the user wants → explain and offer the working alternative rather than a dead end.

## 9. Acceptance criteria (excerpt)
- Given a guest with no prior data, when they open a twister, then the page renders text, mode switcher, and Read along is ready with **no permission prompt**.
- Given the user is recording, when they press the browser Back button, then a confirm dialog appears and the recording is untouched until they choose.
- Given `?mode=record&wpm=9999`, then Record mode opens and WPM is clamped to 300.
- Given prefs API is down, then the page is fully usable with local prefs and no error banner is shown (only a non-blocking "Settings not synced" chip).
