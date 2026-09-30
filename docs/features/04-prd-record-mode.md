# PRD 04 — Record Mode (camera / screen recording with layouts, Loom-style)

**Summary:** Users record themselves saying the twister — camera on, optionally with screen/tab capture — using a choice of **layouts** that place the twister text and the camera feed. They then **review** the take (playback, captions, mistake markers, score), and **save, download, or share** it. Local-first: a recording never leaves the device unless the user chooses.

## 1. Why
- People improve fastest when they *see* their mouth/face delivery, not just a number.
- Recordings are shareable proof and a private progress diary ("my Day 1 vs Day 14 take").
- Differentiator vs. typical twister apps; gives us a natural growth loop (share links).

## 2. User stories
1. As a learner I want to record my face while reading the twister so I can watch my articulation afterwards.
2. As a presenter I want the twister text to scroll *next to my camera* like a teleprompter so my eyes stay near the lens.
3. As a creator I want a **screen + camera bubble** layout to make a demo/tutorial-style clip.
4. As a cautious user I want to preview my camera, choose devices, and delete a take before anyone sees it.
5. As a mobile user I want a simple camera-only mode that works on my phone.
6. As a returning user I want to compare today's take with a previous take.
7. As a parent I want children's recordings to stay private and off our servers by default.

## 3. Recording sources & layouts

Sources: **Camera**, **Microphone**, **Screen/Window/Tab** (desktop only), **System/tab audio** (Chromium tab capture only), **Twister text layer** (rendered by us).

| # | Layout | Composition | Notes |
|---|---|---|---|
| L1 | **Camera only** | Full-frame camera. Twister text not in video. | Simplest; most compatible; can record raw stream (no canvas) → survives background tab |
| L2 | **Camera + text card** (default) | Camera full-frame; semi-transparent text card in lower third with live word highlight (Read-along engine or speech-driven highlight) | Great for teleprompter feel |
| L3 | **Side-by-side** | Left 50 % twister text (scrolling/highlight), right 50 % camera (rounded) | Good for review clips; 16:9 |
| L4 | **Screen + camera bubble** | Screen/tab/window full-frame; circular camera bubble (S/M/L, draggable to 4 corners) | Loom-like; desktop only |
| L5 | **Text focus + PiP camera** | Big text stage; small camera PiP corner | For long/marathon passages |
| L6 | **Portrait 9:16** | Vertical canvas (1080×1920 → 720×1280 default), camera full-frame with text card | Social sharing; mobile-first |
| L7 | **Region of app** *(Chromium)* | Records only the Practice Stage element via element/region capture | "Some area of the screen" — see §3.1 |

Backgrounds & polish (P2): background blur/virtual bg (MediaPipe selfie segmentation, opt-in, GPU-heavy → off by default), brand-safe gradient backdrop for L3/L5, mirror toggle (preview always mirrored; **saved video un-mirrored by default** so any text on clothes reads correctly; toggle available), thumbnails, lower-third title.

### 3.1 "Whole screen or some area of it"
- **Whole screen / window / tab:** `getDisplayMedia` — user picks in the browser's native picker. We cannot pre-select or resize it.
- **Area of *our page*:** Chromium's **Element Capture / Region Capture** can restrict a tab-capture track to a single DOM element (the Practice Stage). Supported on Chromium only → offered as L7 with capability detection; other browsers see L1–L6.
- **Arbitrary rectangle of the desktop:** not possible via web APIs. Offer **post-capture crop** (Phase 2): user drags a crop box on the preview; we crop in the compositing canvas on re-encode or during playback export. State this limitation in UI copy: "Pick a window or tab; you can crop after recording."

## 4. Recording flow

```
Setup ─► (permissions) ─► Preview ─► Countdown ─► Recording ─► (pause/resume) ─► Stop ─► Review ─► Save / Download / Share / Discard / Re-record
```

### 4.1 Setup screen
- Layout picker (thumbnails of L1–L7, unsupported ones hidden or disabled with reason).
- Device pickers: camera, microphone (+ live level meter), resolution (Auto / 720p / 1080p), frame rate (30).
- Options: text style (highlight mode: Read-along pacing **or** speech-driven), speed (WPM) if Read-along pacing, show live score (if speech-driven), captions burn-in (off), mirror preview, countdown (0/3/5 s), noise suppression / echo cancel (on).
- Privacy line: "Recordings stay on this device unless you save them to your account."
- Quality guard: estimated file size for chosen settings + current storage headroom.

### 4.2 Preview
Live composite preview identical to what will be recorded (same canvas), with **audio meter**, "Lighting tip" (face luminance analysis: too dark/too bright hint), "Face in frame" hint (simple face-detector API `FaceDetector` where present, else skipped). No recording yet.

### 4.3 Countdown → Recording
- 3-2-1 overlay (not recorded), then red ● REC, elapsed timer, remaining time vs limit, **Pause / Resume / Stop / Restart / Discard**. Shortcuts: `Space` pause, `Esc` stop (confirm), `R` restart.
- Text layer behaviour: **Read-along pacing** (auto moves at WPM) or **Speech-driven** (highlights as you speak, using Speak & score engine). Optional **both**: pacing guide + live match.
- The stage shows a subtle recording indicator; tab title changes to "● Recording — Twister" so users notice on other tabs.
- Auto-stop when limit reached (warning at −30 s and −10 s). Optional auto-stop when the twister finishes (+1.5 s tail).
- Chunks are persisted to **IndexedDB every 1 s** (crash recovery, see §8).

### 4.4 Stop → Review
Immediately finalise the blob (fix WebM duration/cues), generate a thumbnail and waveform, run Speak & score analysis on the recorded audio if the session was speech-driven (or on demand: "Analyse my take"), and open the Review page.

## 5. Review page (results)

Layout (desktop): left = **video player**, right = **Analysis panel**; mobile stacks.

**Player:** custom controls — play/pause, scrub with **mistake markers** (red ticks at missed/wrong words; amber for near), speed 0.5×–2×, fullscreen, captions on/off (auto-generated from word timings; also downloadable `.vtt`), mirror toggle for playback, frame-step (`,` `.`).
**Analysis:** score ring + breakdown (accuracy/speed/fluency), the **word diff** from 03, "What we heard" transcript with karaoke sync to the video, delivery hints (pace vs target WPM, longest pause, filler count).
**Actions:** Save to account · Download (`.webm`/`.mp4`) · Copy link (after save) · Re-record · Try Speak & score · Delete.
**Details:** editable title (default "Fuzzy Wuzzy — 29 Sep"), privacy (Private / Anyone with the link + expiry 24 h / 7 d / 30 d / never), notes.
**Compare (P3):** choose a previous take → synced side-by-side players and score delta.
**Trim (P2):** set in/out handles; export re-muxes (no re-encode when possible).

## 6. Technical approach (client)

| Concern | Decision |
|---|---|
| Capture | `getUserMedia({video:{width,height,frameRate,deviceId}, audio:{echoCancellation,noiseSuppression,autoGainControl,deviceId}})`; `getDisplayMedia({video:{frameRate:30}, audio:true})` for L4/L7 |
| Composition | Hidden `<canvas>` (720p default) drawing layers each frame: camera `<video>`, screen `<video>`, text layer (same React render → drawn via offscreen DOM-to-canvas primitives; text laid out with `measureText`), bubble mask. `canvas.captureStream(30)` → video track |
| Audio mix | Web Audio: mic (+ tab audio if present) → `GainNode` → `MediaStreamAudioDestinationNode` → audio track; mic level meter via `AnalyserNode` |
| Recorder | `MediaRecorder(stream, {mimeType, videoBitsPerSecond})`; `timeslice = 1000` |
| MIME negotiation | Try in order: `video/webm;codecs=vp9,opus` → `vp8,opus` → `video/mp4;codecs=avc1.42E01E,mp4a.40.2` → `video/mp4` → browser default; store the chosen type on the recording |
| Bitrates | 720p30: 1.5–2.5 Mbps; 1080p30: 4–6 Mbps; audio 128 kbps. Default 720p @ 2 Mbps (~15 MB/min) |
| Background-tab problem | `requestAnimationFrame` pauses in hidden tabs → composited layouts freeze. Use a **Worker-driven frame clock** (`setInterval` in a dedicated Worker posting ticks) + warn "Keep this tab visible"; auto-pause on hidden ≥ 3 s with banner. L1 (raw stream) is unaffected |
| Duration/seek bug | Chrome WebM from MediaRecorder lacks duration/cues → fix client-side after stop (EBML patch, e.g. `fix-webm-duration`/`ts-ebml`) or server remux |
| Crash recovery | Persist chunks (`Blob`) to IndexedDB under `recording_id`; on next visit detect `status=recording` orphan → "Recover your last recording?" (assemble chunks → Review) |
| Memory | Never hold the whole recording in an array beyond the current chunk when > 2 min; stream chunks to IndexedDB and assemble at stop |
| Storage guard | `navigator.storage.estimate()` — block start if free < 3× estimated size; request `navigator.storage.persist()` |
| Device changes | Listen to `devicechange` and to `track.onended`; on loss, pause, keep captured data, prompt to reconnect or finish |
| Screen share stop | `videoTrack.onended` (browser's "Stop sharing") ⇒ treat as Stop (L4/L7) or switch to camera-only if user chooses |
| Wake lock | `navigator.wakeLock.request('screen')` during recording where supported |
| Code splitting | Record bundle lazily loaded; heavy libs (segmentation, EBML) loaded on demand |

## 7. Limits, quotas & retention (defaults; configurable per plan)

| Limit | Free | Notes |
|---|---|---|
| Max length per recording | 3 min (5 min planned) | Twisters are short; limit protects storage |
| Cloud recordings stored | 5 | Oldest not auto-deleted; user must free space |
| Total cloud storage | 100 MB (≈ 6–7 min @ 2 Mbps) | **Check current Supabase plan limits** — Free plan includes ~1 GB total storage and a per-file upload cap (historically 50 MB); design for < 50 MB per file |
| Share link default expiry | 7 days | Max 30 days on free |
| Retention of cloud recordings | 30 days from last view, or until deleted | Reminder email 3 days before expiry |
| Local (device) recordings | unlimited | User-managed |

Quota is enforced **server-side** at `POST /recordings/` (reserve bytes) and again at `complete`.

## 8. Reliability & recovery
- **Never lose a take:** 1 s chunked persistence; orphan recovery; upload resumable (TUS) with retry/back-off; upload continues after navigation (service-worker background sync where supported, otherwise a global upload manager with "Uploading… don't close" beforeunload guard).
- **Partial recordings:** if the stream dies at 47 s, we keep the 47 s and label it "Ended early (camera disconnected)".
- **Failure classes & UX:** permission denied, device busy, device missing, overconstrained (fallback to lower resolution automatically, tell the user), codec unsupported (fallback chain), recorder error, out-of-space, upload failure (keep local copy, retry), processing failure (offer download of original).

## 9. Privacy, consent, safety
- Explicit **consent screen** the first time a user saves to cloud: what is stored, who can see it, retention, how to delete (`UserConsent(type=recording_upload)`), plus a separate consent for *voice/transcript analysis by a third-party STT vendor* if used.
- **Minors:** if `age_band = under_13` (or unknown & signed-in accounts flagged), cloud upload and link sharing are disabled; local-only.
- **Bystanders & sensitive content:** notice "Recordings may capture people/screens around you"; screen-share picker reminder to close private tabs; optional blur-notifications reminder.
- **Moderation:** shared links can be reported; reports create `ModerationReport`; admins can disable a link and delete the asset; repeated abuse → feature ban.
- **No biometrics:** we do not perform face recognition or store face embeddings. Face-in-frame hint runs locally and is not stored.
- **Security:** private bucket; access only via short-lived signed URLs (≤ 1 h) minted by the API after auth or valid share token; `Content-Disposition` for downloads; `noindex`; rate-limit link resolution; no hotlink to public CDN.
- **Deletion:** removing a recording deletes DB row + storage object + thumbnail (soft-delete 24 h for undo, then hard delete job).

## 10. Cloud pipeline (P4)

```
Client                         API (Django)                    Supabase Storage        Worker (Render/Fly/Cloud Run)
  │ POST /recordings/ (meta) ─►  validate quota, consent
  │ ◄─ {id, upload:{url,token}} ─┤ create MediaAsset(pending_upload)
  │ PUT (TUS resumable) ─────────────────────────────────────────►  object
  │ POST /recordings/{id}/complete ─►  HEAD object, size/mime check ; status=uploaded
  │                                   enqueue job ─────────────────────────────►  ffmpeg: thumbnail, mp4/H.264 transcode (if webm), loudness normalise, poster, .vtt
  │ ◄─ poll GET /recordings/{id} ─── status=processing → ready ◄──── callback/update
```
- Transcoding is required for universal playback (older Safari/iOS can't play some WebM). **MVP can skip** transcode and store as-recorded, playing back in browsers that support the codec, with a "Download to view" fallback; ship transcode in P4.
- Vercel functions can't run long ffmpeg jobs → use a separate worker service; Django only enqueues (DB-backed queue table or a managed queue).

## 11. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| V1 | Camera-only recording with mic, local preview, countdown, pause/resume, stop | P0 (P3) |
| V2 | Camera + text card layout (Read-along pacing) | P0 (P3) |
| V3 | Side-by-side, Text focus + PiP layouts | P1 |
| V4 | Portrait 9:16 layout | P1 |
| V5 | Review page with player, captions, mistake markers, score | P1 |
| V6 | Download `.webm`/`.mp4` (local) | P0 |
| V7 | IndexedDB chunk persistence + recovery | P0 |
| V8 | Screen + camera bubble layout | P2 (P4) |
| V9 | Region/element capture layout (Chromium) | P2 |
| V10 | Cloud save with quota, consent, signed uploads (TUS) | P1 (P4) |
| V11 | Share links (unlisted, expiry, revoke) | P1 (P4) |
| V12 | Transcode + thumbnail worker | P1 (P4) |
| V13 | Trim, compare takes, background blur | P3 |
| V14 | Moderation/reporting | P1 (before public-ish sharing) |

## 12. Edge cases

| # | Case | Behaviour |
|---|---|---|
| 1 | Camera denied / mic denied separately | Explain which; allow **audio-only** or **camera-only-no-audio** (warn) or fall back to Read along/Speak |
| 2 | No camera device (desktop) | Offer audio-only recording (waveform layout) |
| 3 | Camera busy in another app (Zoom/Meet) | NotReadableError copy; retry button; suggest closing other app |
| 4 | Device unplugged mid-recording | Pause, keep data, banner "Camera disconnected" with Reconnect / Finish now |
| 5 | Screen share stopped via browser bar | End screen track; continue with camera-only or stop (user choice) |
| 6 | Tab switched / window minimised | Composited layouts: auto-pause + banner; L1: continue |
| 7 | Laptop lid closed / sleep | On wake detect time gap; mark gap; offer to trim |
| 8 | Out of disk/quota | Stop cleanly, keep saved part, guide to free space |
| 9 | Browser crash / accidental refresh | Recovery prompt on next visit |
| 10 | MediaRecorder unsupported / codec missing | Hide Record tab; explain; suggest Chrome/Safari update |
| 11 | iOS Safari | Camera + mic only (L1, L2, L6); no screen layouts; video plays inline (`playsinline`); mp4 output; must start from a tap |
| 12 | Android Chrome | Same as iOS but webm; check that `facingMode` toggle (front/back) works |
| 13 | Device rotation mid-recording | Lock layout to chosen orientation; canvas size fixed; show hint |
| 14 | Very low light / no face | Non-blocking hint only |
| 15 | Echo/feedback (speakers + mic) | Enable AEC; tip "Use headphones"; detect sustained loop and warn |
| 16 | A/V sync drift | Single audio clock (Web Audio) for the mix; monitor drift; fallback to raw stream for L1 |
| 17 | Long recording near limit | Warn at −30 s / −10 s; auto-stop; never truncate silently |
| 18 | Upload fails at 80 % | Resume (TUS); persistent "Retry upload" chip; local copy retained |
| 19 | User deletes account mid-upload | Abort upload; delete partial object; no orphan rows |
| 20 | Share link opened after expiry/revocation | 410 Gone page with friendly message; no metadata leak |
| 21 | Link guessed/enumerated | 128-bit tokens; constant-time compare; per-IP rate limit |
| 22 | Playback on browser that can't decode | Show poster + "Download to watch" + transcoded MP4 when ready |
| 23 | Guest (not signed in) | Can record and download locally; cloud/share requires sign-in; recording kept in IndexedDB until download or 24 h |
| 24 | Two recorders (two tabs) | Session lock: second tab is blocked with explanation |
| 25 | Content policy hit on report | Link disabled instantly; owner notified; asset quarantined |
| 26 | Timestamps/timezones | All stored UTC; UI shows local |
| 27 | Accessibility | Recording state announced; timer not announced each second (announce every 30 s); all controls keyboard accessible; captions provided |

## 13. Acceptance criteria (excerpt)
- Given a supported browser and granted permissions, when the user picks L2 and presses Record, then a 3-2-1 countdown plays (not in the file), the file starts at "GO", and stopping yields a playable file with correct duration and seek.
- Given a hidden tab in L2, then recording auto-pauses within 3 s and the banner explains why.
- Given the page is reloaded mid-recording, then on return the user is offered recovery and the recovered file contains ≥ (elapsed − 1 s) of media.
- Given quota is full, then `POST /recordings/` returns `402/409 quota_exceeded` with a clear message and local download remains available.
- Given a revoked share link, then the API returns 410 and never returns a signed media URL.

## 14. Telemetry
`record_setup_open` · `record_permission {kind,result}` · `record_start {layout,res,fps,mime}` · `record_pause/resume` · `record_stop {duration_ms,size_bytes,reason:user|limit|error|device|tab_hidden}` · `record_recover` · `record_download` · `record_save_cloud {size,ms}` · `record_share_create` · `record_error {class}`.
