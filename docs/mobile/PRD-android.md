# Twister Android App: Product Requirements Document

**Status:** v0.1 draft · **Owner:** Pawan · **Last updated:** 2026-10-03 · **Data model:** [ERD-android.md](ERD-android.md)

Extends [PRD.md](../PRD.md) and the Practice Suite docs in [features/](../features/00-overview-and-roadmap.md). Where they overlap, this file covers only what Android changes.

## 1. Overview and goals

Twister Android puts the existing Twister web product on Google Play as an installable app built from the same codebase, with offline practice, native speech and permissions handling, and a design that passes Play review on the first submission. It is based on what is in your `Twister` repo today: a TanStack Start (React 19) web app in `web/`, a Django 5.2 + DRF API in `api/` on Supabase Postgres and Auth, a scoring worker in `worker/`, and a Practice Hub with three modes (Read along, Speak & score, Record).

**Problem.** The web app is already installable as a PWA, but a PWA cannot be listed with full Play Store presence, cannot rely on the browser speech API on every Android device, loses the session when connectivity drops, and gives no push, no store ratings and no discoverability. Your own roadmap names native apps as out of scope for MVP; this document is the plan to lift that.

**Goals**

- Publish a signed Android App Bundle to Google Play (production track) that passes policy review without rejection.
- Reuse at least 90% of the web UI and business logic; one codebase, one design system, one API.
- Every core loop (browse, read along, speak and score, view history) works with no network, and degrades cleanly on slow or flaky networks.
- Run well on Android 8.0+ (API 26+) across phones, tablets and foldables, including 2 GB RAM devices.
- Keep audio and video on the device unless the user opts in, as the web product already promises.

**Non-goals (v1)**

- iOS app (the architecture keeps the door open; see section 2).
- A separate native UI rewrite (Kotlin or React Native).
- Payments or subscriptions (the `Plan` table ships with `free` only, per decision D11).
- New product features that do not exist on the web.

**Personas** (from the web PRD, now with an Android lens)

| Persona | Android-specific need | Hook |
| --- | --- | --- |
| Casual player | Opens in under 2 s, plays on a commute with patchy signal | Daily twister, push reminder |
| Language learner | Pronunciation drills that work with a quiet earphone mic | Weak-word queue, offline history |
| Speaker or presenter | Warm-up before a talk, often on hotel wifi | Streaks, Record mode |
| Parent or teacher (13+ only in v1) | Safe, ad-free, no surprise uploads | Clear consent screens |

**Success metrics (first 90 days after launch)**

| Metric | Target |
| --- | --- |
| Crash-free users (Android vitals) | at least 99.5% |
| ANR rate | below 0.3% (Play bad-behaviour threshold is 0.47%) |
| Cold start to interactive, mid-range phone | under 2.5 s |
| Install to first scored attempt | at least 55% within the first session |
| D1 / D7 retention | at least 28% / 12% |
| Play store rating | at least 4.3 |
| Sessions started offline that complete a scored attempt | at least 95% |
| Play policy violations or suspensions | 0 |

## 2. Conversion strategy and architecture

Recommendation: wrap the existing React app with Capacitor (the latest major that supports Android API 36) as a locally bundled single-page build, keep Django and Supabase unchanged, and add native plugins only where a WebView cannot do the job (speech, push, sign-in, storage). This keeps one codebase and ships the store listing in weeks, not quarters.

| Option | Reuse of web code | Offline | Native speech and permissions | Play Store fit | Verdict |
| --- | --- | --- | --- | --- | --- |
| PWA only (current) | 100% | Service worker only | Browser-dependent | Not listable | Keep as the web fallback |
| Trusted Web Activity (Bubblewrap) | 100% | Service worker only; runs in Chrome | Web Speech depends on Chrome, no native plugins | Listable, but thin app and Play can flag minimal functionality | Backup plan |
| **Capacitor (recommended)** | About 95% | Assets bundled in the APK; local DB | Native plugins for speech, mic, push, deep links | Listable, full native shell | **Chosen** |
| React Native or Flutter rewrite | Under 30% | Full | Full | Listable | Rejected: rewrites the Practice Hub and the on-device ONNX engine for no user benefit in v1 |

**Why Capacitor fits this codebase**

- The Android WebView does not implement the Web Speech API that `web/src/lib/speech.ts` uses today. Read along works, but Speak & score needs either the native Android recogniser through a plugin or the in-house ONNX engine that already runs in a Web Worker (`onnxruntime-web`). Both are reachable from Capacitor; neither is reachable from a bare WebView.
- `getUserMedia` and `MediaRecorder` work in the Android WebView once the app grants the microphone and camera permission to the WebView, which Capacitor handles.
- The app already stores guest takes in IndexedDB (`idb`) and has an offline attempt queue (`attemptQueue.ts`, `syncQueue.ts`), so offline-first needs extension, not invention.

**Required changes to the web app before wrapping**

1. Add a static SPA build target. TanStack Start currently builds an SSR Nitro server (`web/.output`). Capacitor needs plain static files, so add a second build mode (SPA with a prerendered shell) that sets `VITE_TARGET=android`. The Vercel SSR build stays for the website and for SEO routes like `/s/:token`.
2. Serve the WebView from `https://localhost` (`androidScheme: 'https'`) so `getUserMedia`, service workers and secure cookies behave as on the web. Add that origin and the `capacitor://` equivalents to the Django `CORS_ALLOWED_ORIGINS` and to the CSP `connect-src`.
3. Replace Google OAuth in the WebView. Google blocks OAuth inside embedded WebViews (`disallowed_useragent`), so sign-in uses the native Google Credential Manager plugin and passes the ID token to `supabase.auth.signInWithIdToken`. Email and password keep working as is. Magic links and password resets use verified App Links back into the app.
4. Replace `localStorage` for anything that must survive WebView storage clearing (the guest queue key `twister.guest.v1`, preferences, auth session) with IndexedDB or the Capacitor Preferences plugin, and request persistent storage.
5. Route all file downloads (recordings, JSON export) through the Android share sheet or Storage Access Framework, because WebView ignores `<a download>` blobs.

**Target architecture**

The Android shell contains the bundled web app, a local store, and a thin plugin layer. The network layer talks to the same Django API through a retry-aware client, and the heavy scoring stays on device first, with the existing worker as the optional spot-check path.

| Layer | Choice | Notes |
| --- | --- | --- |
| Shell | Capacitor (latest major), Kotlin 2, compileSdk 36 and targetSdk 36 (Play requirement since 31 Aug 2026) | Single activity, edge-to-edge |
| UI | Existing React 19, Tailwind 4, Radix | Add safe-area tokens and a bottom tab bar on compact widths |
| Local data | IndexedDB (idb) for attempts, twister catalogue, preferences; filesystem for take media | SQLite plugin only if catalogue size or query needs outgrow IndexedDB |
| Network | `fetch` wrapper with timeouts, backoff, idempotency keys, ETag caching | Reuses the `Idempotency-Key` and `client_attempt_id` contract in the API |
| Speech | Tier 1: on-device ONNX engine (flag `accurate_mode`). Tier 0: native Android SpeechRecognizer via plugin. Tier fallback: typed input | Never depends on Web Speech in WebView |
| Push | Firebase Cloud Messaging, replacing the e-mail only reminders | Opt-in, Android 13+ runtime permission |
| Crash and analytics | Existing Sentry and PostHog, plus Firebase Crashlytics for native crashes | Keep PostHog cookieless and consent-gated |
| Backend | Unchanged: Django 5.2, Supabase Postgres and Auth, Fly scoring worker | Add `/api/v1/device-tokens/` and `/api/v1/app-config/` |

## 3. Functional requirements

Every existing web feature ships on Android at parity, and the items marked Android-only exist because the platform needs them. Priorities: P0 blocks the Play release, P1 ships in 1.0, P2 follows within two releases.

| ID | Requirement | Source | Priority |
| --- | --- | --- | --- |
| A1 | Guest-first: browse, Read along and Speak & score with no account | Web F1 | P0 |
| A2 | Library browse, search, filters (level, category, origin), daily twister, random | Web F2, F6 | P0 |
| A3 | Read along mode with speed control, model voice (TTS), keyboard and touch controls | Hub P1 | P0 |
| A4 | Speak & score with live word highlighting, mistakes view, Train, word drill | Hub P2 | P0 |
| A5 | Scoring runs on device when offline; attempts queue and sync when online, deduplicated by `client_attempt_id` | Web offline queue | P0 |
| A6 | Sign in with email and password, and with native Google sign-in; sign out; account deletion inside the app | Web F7, D21 | P0 |
| A7 | Progress: XP, levels, streaks and freezes, achievements, stats, favourites | Hub P5 | P1 |
| A8 | Record mode with camera, local save, crash recovery, share through the Android share sheet | Hub P3 | P1 |
| A9 | Cloud recordings and share links, behind flags `record_cloud` and `share_links` | Hub P4 | P2 |
| A10 | Generate Twister (private, LLM-written), behind flag `generate_twister` | Round 2 | P2 |
| A11 | Settings: theme (system, light, dark), language and accent, reduced motion, text size, consent management, data export, delete data | Web settings | P0 |
| A12 | Android only: push reminders with a daily time and a one-tap disable, replacing e-mail only reminders | New | P1 |
| A13 | Android only: deep links and App Links for `/s/:token` score cards, `/r/:token` recordings, and `/auth/callback` | New | P0 |
| A14 | Android only: share a score card as an image through the system share sheet | New | P1 |
| A15 | Android only: forced update and soft update prompts through Play In-App Updates; remote kill switch through `app-config` | New | P1 |
| A16 | Android only: in-app review prompt (Play In-App Review) after a personal best, at most once per 90 days | New | P2 |
| A17 | Android only: home screen shortcuts (Daily twister, Random, Continue) and an optional home widget with the streak | New | P2 |
| A18 | Android only: Android 13+ per-app language, and backup rules that exclude tokens and recordings | New | P1 |

**Permissions and when they are asked**

The Hub principle already says to ask late and explain why. On Android that becomes a pre-prompt screen before the system dialog, and a settings shortcut when the user denied twice.

| Permission | Used for | Asked when | If denied |
| --- | --- | --- | --- |
| `RECORD_AUDIO` | Speak & score, Record | User taps Start speaking the first time | Offer Read along and typed input; deep link to app settings |
| `CAMERA` | Record with camera layouts only | User opens a camera layout | Offer audio-only or text layout |
| `POST_NOTIFICATIONS` (Android 13+) | Reminders | After the second completed attempt, never at first launch | Reminders stay off; in-app banner explains |
| `INTERNET`, `ACCESS_NETWORK_STATE` | API, connectivity detection | Install time (normal) | n/a |
| `FOREGROUND_SERVICE_MICROPHONE` | Only if a long take must survive screen lock | Not requested in 1.0 | n/a |

Not requested, by design: location, contacts, SMS, call log, broad storage access, advertising ID, and `SYSTEM_ALERT_WINDOW`. Fewer permissions means a smaller Data safety form and faster review.

**Android system behaviours the app must handle**

- Back gesture and predictive back: a take in progress shows a leave guard; the hub returns to Browse, not out of the app. Set `android:enableOnBackInvokedCallback`.
- Process death: the WebView state is rebuilt, so the current take, session id and draft are persisted every few seconds (the Hub already persists takes incrementally).
- Audio focus: pause the model voice when a call or another app takes focus; resume only on user action.
- Interruptions: an incoming call, a Bluetooth headset connecting, or the screen turning off ends the take safely with the reason `device`.
- Bluetooth headset mics: detect the route, show a one-line hint when the input is a low-bandwidth SCO profile, since scoring accuracy drops.

## 4. Responsiveness and device support

The app must be usable and tested on any Android 8.0+ device from a 4.7 inch, 2 GB phone to a 12 inch tablet and a foldable, in portrait and landscape, so layout is driven by window size classes, not device names.

**Window size classes** (Material 3 breakpoints in dp of the visible window, not the screen, to handle split screen and foldables)

| Class | Width | Layout |
| --- | --- | --- |
| Compact | under 600 dp | Single column, bottom tab bar (Home, Browse, Practice, Stats, Profile), full-width practice stage |
| Medium | 600 to 839 dp | Navigation rail, practice stage with a side panel for history |
| Expanded | 840 dp and wider | Rail plus two panes: list on the left, Practice Hub on the right (list-detail) |

**Rules**

- Use CSS container queries and `dvh`, `svh` units, never `100vh`, so the address bar and keyboard do not clip the mic button.
- Edge-to-edge drawing with `viewport-fit=cover`; pad with `env(safe-area-inset-*)` for the status bar, gesture bar, display cutouts and foldable hinge (`env(viewport-segment-*)`).
- Minimum tap target 48 dp (the web docs say 44 px; Play accessibility review and Material use 48 dp), 8 dp spacing between targets.
- The primary action (mic, record) sits in the thumb zone at the bottom, and never under the gesture bar.
- Keyboard: when the soft keyboard opens (typed fallback, search), resize the layout with the Capacitor Keyboard plugin in `resize: 'body'` mode so inputs stay visible.
- Orientation: unlock all orientations. Practice and Read along work in landscape with larger text; Record keeps the layout the user picked and re-composites on rotate without dropping the take.
- Large screens: the text scale slider (0.8 to 2.0 in `UserPreference.font_scale`) is combined with the system font scale up to 200% without clipping.
- Dark mode follows the system by default and keeps the existing theme menu; the status and navigation bar icons switch with it.
- Reduced motion: honour both the web `prefers-reduced-motion` and Android's Remove animations setting (confetti, Lottie and pulses off).
- Dynamic frame rate: cap animation at 60 fps on 60 Hz panels and avoid layout thrash; no animation runs while the app is in the background.

**Device test matrix** (minimum before each release; Firebase Test Lab for the automated rows, physical devices for the others)

| Group | Examples | Why |
| --- | --- | --- |
| Low end | 2 GB RAM, Android 8 to 10, Go edition | Memory pressure, ONNX engine load time, WebView age |
| Mid range | Android 12 to 13, 4 to 6 GB | The main user base |
| Current flagship | Android 15 | Edge-to-edge enforcement, predictive back |
| Small phone | 5 inch, 720 p | Clipping, tap targets |
| Tablet | 10 to 11 inch | Rail and two-pane layouts |
| Foldable | Inner and cover display, tabletop posture | Window changes mid-take, hinge |
| Manufacturers | Samsung, Xiaomi or Redmi, Oppo or Realme, Vivo, Motorola, Google Pixel | Battery killers, custom permission UIs, WebView forks |
| Locales and scripts | en-IN, en-US, en-GB, RTL pseudo-locale, 200% font | Text overflow, mirrored layouts |

**Android WebView policy.** The app depends on a modern System WebView (Chromium 110 or newer for ES2022, module workers and WebAssembly SIMD). On start, read the WebView version; if it is older than the minimum, show a blocking screen with a link to update Android System WebView in Play, instead of a white screen. Practice does not rely on features newer than that baseline.

**Accessibility** (Play accessibility checks and WCAG 2.2 AA)

- TalkBack: every control has a name and role; live regions announce Listening, Recording started and the score (already in the Hub spec).
- Colour is never the only signal for correct, near and wrong words; keep the underline, icon and strike patterns.
- Fix the known login contrast gap (4.46 to 4.5 or more, item C5 in the status doc) before release.
- Switch Access and keyboard navigation work with visible focus.
- Run the Google Accessibility Scanner and the Play pre-launch report on every release candidate.

## 5. Low network and offline handling

The app is offline-first: the UI renders from local data, writes go to a local queue first, and the network only reconciles. A take is never lost, and no screen shows a blank spinner for more than 3 seconds.

**Connectivity model.** The app tracks four states with the Capacitor Network plugin plus a real reachability probe (`HEAD /api/health/`, since Wi-Fi with no internet reports as connected): Online, Slow (round-trip over 1.5 s or effective type 2g and 3g), Offline, and Captive or Blocked. A small banner shows the state; nothing blocks the user.

| Feature | Offline behaviour | Slow network behaviour | Back online |
| --- | --- | --- | --- |
| Twister library | Full catalogue and facets from the local copy, refreshed by ETag; first install bundles a seed of all public twisters | Show local copy at once, refresh in the background | Delta refresh by `updated_since` |
| Read along | Fully works; model voice uses on-device Android TTS | No change | n/a |
| Speak & score | On-device engine or native recogniser scores locally; result marked Provisional | Same; no upload wait | Attempt posts with its `client_attempt_id`; server result replaces the local one |
| History and stats | Local attempts shown; server aggregates shown with an Updated at label | Cached aggregates first | Reconcile through `POST /attempts/sync/` (batches of 50) |
| Sign in | Existing session works; new sign in needs network and says so | Longer timeout, one visible retry | Session refresh in background |
| Daily twister | Computed locally from the same deterministic rotation (day and catalogue) | Cached | Verified against `/daily/` |
| Record | Local only (IndexedDB chunks, as in the web hub); cloud save paused | Chunked resumable upload (TUS) with pause and resume | Upload resumes from the last confirmed byte, only on Wi-Fi unless the user allows mobile data |
| Generate Twister, share links, leaderboards | Disabled with a clear one-line reason | Longer timeout, cancel allowed | Enabled |
| Push reminders | Delivered by FCM when reachable | n/a | n/a |

**Request policy** (one shared client in `web/src/lib/api.ts`)

- Timeouts: 8 s for reads, 15 s for writes, 60 s for uploads per chunk; always cancellable on navigation.
- Retries: only idempotent calls or calls with an `Idempotency-Key`; exponential backoff with jitter (1 s, 2 s, 4 s, 8 s, cap 5 attempts), honour `Retry-After` on 429 and 503.
- Never retry 4xx except 408, 409 with a replay header, and 429.
- Stale-while-revalidate for catalogue reads, matching the API's `Cache-Control: public, max-age=60, stale-while-revalidate=300`.
- Compression: gzip or brotli on the API, JSON payloads trimmed with `?fields=` on Browse, images as AVIF or WebP at 1x and 2x only.
- Data saver: respect the Android Data Saver and the `Save-Data` hint, turning off prefetch, Lottie and auto-upload.
- Never block first paint on a request: render the bundled shell, then hydrate.

**Local store and sync queue**

- Outbox table in IndexedDB with `id`, `type`, `payload`, `idempotency_key`, `created_at`, `attempts`, `next_retry_at`, `status`. Types: attempt, session, favourite, preference, consent, recording\_upload.
- Drain on: app foreground, connectivity regained, a 15 minute WorkManager task for pending items (battery friendly, requires network), and after each successful write.
- Conflict rules: attempts are append-only and deduplicated by client id; preferences are last write wins by `updated_at`; favourites are set unions with delete tombstones; server is the source of truth for XP, level, streak and verification status.
- Poison items (three consecutive 422 responses) move to a dead-letter list the user can see in Settings, and are reported to Sentry without personal content.
- Storage budget: cap local media at 500 MB or 10% of free space, delete oldest synced recordings first, and warn before a take if free space is under 100 MB.
- Persist outbox and take chunks before showing any success state.

**Degraded states and copy**

Every error uses the API error envelope (`error.code`) mapped to a short, kind message with one action. Examples: offline during sign in (Connect to sign in. You can keep practising meanwhile.), upload paused (Saved on your phone. Uploading when you are on Wi-Fi.), server down (We could not reach Twister. Your takes are safe and will sync later.). Provide a status page link only for outages longer than 10 minutes.

**Battery and background.** No continuous background services. Syncs use WorkManager with a network constraint, FCM handles reminders, and the app stops the microphone and camera the moment it goes to the background.

**Targets to test under throttling** (Chrome DevTools profiles and an Android emulator with network shaping)

| Profile | Condition | Pass criteria |
| --- | --- | --- |
| Offline | Airplane mode | Browse, Read along, Speak & score, history all work; no error toasts for background sync |
| 2G | 50 kbps, 800 ms RTT | Home interactive under 4 s from cache; no request blocks the UI |
| Slow 3G | 400 kbps, 400 ms RTT | Attempt submit confirms locally in under 300 ms |
| Flaky | 30% packet loss | Zero duplicate attempts, zero lost attempts after reconnect |
| Lie-fi | Connected to Wi-Fi with no internet | Banner shows Offline within 5 s; queue holds |

## 6. Google Play policy compliance

The release is blocked unless every row below is done and evidenced in the release checklist. Facts marked with a source were checked on 2026-10-03; re-check the linked page before each submission because Play rules change several times a year.

| # | Requirement | What Twister does | Evidence |
| --- | --- | --- | --- |
| P1 | Target API: new apps and updates must target Android 16 (API 36) since 31 Aug 2026 ([Android developers](https://developer.android.com/google/play/requirements/target-sdk)) | `targetSdk 36`, `compileSdk 36`, minSdk 26; use a Capacitor major version that supports API 36 | Gradle config in CI check |
| P2 | Publish as an Android App Bundle (AAB), signed with Play App Signing | CI builds `bundleRelease`; upload key kept in a secrets manager, never in the repo | Release artifact |
| P3 | Closed testing before production for personal developer accounts created after 13 Nov 2023: at least 12 testers opted in for 14 continuous days ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en)) | Recruit 20 testers in week 1 to leave a margin. Organisation accounts (Breakout as a registered business) are not subject to this; confirm which account type you are using | Closed-test dashboard |
| P4 | Privacy policy URL, public, non-PDF, in the listing and reachable inside the app | Publish at `twister.meetpawan.com/privacy` and link from Settings, Sign in and the permission pre-prompts. It must name Google speech or any third party that receives data | URL and screenshot |
| P5 | Data safety form matches real behaviour | See the declaration table below; update it in the same pull request that changes data collection | Exported form CSV |
| P6 | Account deletion: in-app path, plus a web link to request deletion, plus the deletion answers in the Data safety form ([Play Console Help](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-GB)) | The API already implements `DELETE /me/` with a 30-day grace period, cancel, and export (decisions D21 and D22). Add the in-app entry under Settings, Account, and a public web page `/account/delete` that works without installing the app. State the 30-day grace and what is retained (consent log) in the privacy policy | Screen recording and URL |
| P7 | Permissions: only those needed, each justified, requested in context | Table in section 3. No location, contacts, SMS, call log or all-files access. Declare `RECORD_AUDIO` and `CAMERA` usage in the listing description | Manifest lint |
| P8 | Minimum functionality and no thin web wrapper | App bundles all assets, works offline, and adds push, native sign-in, native speech, share, shortcuts and in-app update. Keep a native feature list in the review notes | Review notes |
| P9 | User generated content and AI generated content: report mechanism, moderation, and blocking | Share links already have `POST /public/r/{token}/report/` with auto-hide after 3 reports and a 24 h takedown target. Add a Report button inside the app on any shared recording or generated twister, a content filter on `Generate Twister` output, and a short in-app note that content is AI generated | Test cases in QA matrix |
| P10 | Families and children: Twister is 13 and over (decision D6) | Declare target audience 13+ in Play Console, never include under-13 age bands in the Target audience, no child-directed marketing, no ads. Keep the under-13 restrictions that already exist (no uploads, no sharing, no boards), and add an age screen at first sign in | Target audience form |
| P11 | Content rating questionnaire (IARC) | Answer honestly: user interaction through share links, user generated content, voice and camera capture. Expect a Teen or Everyone 10+ outcome depending on answers | Rating certificate |
| P12 | No deceptive behaviour, no impersonation, original assets only | The Hub document says UI, copy and assets are original and nothing is copied from the reference app. Keep a licence file for Lottie JSONs, fonts and icons | Licence list |
| P13 | Ads and payments | No ads, no billing in 1.0. Declare Contains ads: No. If billing is added later, use Google Play Billing for digital goods | Console declaration |
| P14 | Network security and secure transport | HTTPS only, `usesCleartextTraffic=false`, network security config pinned to system CAs, TLS 1.2+ | Manifest |
| P15 | Foreground service and background restrictions | No foreground service in 1.0; if added for long takes, declare `FOREGROUND_SERVICE_MICROPHONE` and the use case in the Console | Console declaration |
| P16 | Store listing quality: title up to 30 characters, no keyword stuffing, 2 to 8 phone screenshots, 512 px icon, 1024 by 500 feature graphic, short and full descriptions, tablet screenshots for tablet visibility | Produced from real screens in light and dark mode | Listing checklist |
| P17 | Android vitals thresholds: user-perceived crash rate below 1.09% and ANR below 0.47% overall | Own target is stricter (section 1); alert before thresholds | Vitals dashboard |
| P18 | Pre-launch report clean | Run on each internal release; fix crashes and accessibility findings before promoting | Pre-launch report |
| P19 | Developer contact details, support e-mail, and a takedown contact | Public support address and the takedown address from the pre-launch checklist in the repo | Listing |

**Data safety declaration** (draft for Twister 1.0; verify against the final build)

| Data type | Collected | Shared | Purpose | Optional | Encrypted in transit | Deletable |
| --- | --- | --- | --- | --- | --- | --- |
| Email address | Yes | No | Account, reminders | Optional (guest mode) | Yes | Yes |
| User ID (Supabase user id) | Yes | No | Account, analytics | Optional | Yes | Yes |
| Name or display name | Yes | No | Profile, boards | Optional | Yes | Yes |
| Voice or sound recordings | Only if the user opts in to cloud save or spot-check | No (processed by our own worker, no third-party speech vendor) | App functionality | Optional | Yes | Yes, within 24 h of request or grace-period end |
| Photos and videos (Record mode) | Only if the user opts in to cloud save | No | App functionality | Optional | Yes | Yes |
| App interactions (attempts, scores, streaks) | Yes | No | App functionality, analytics | Required for signed-in accounts | Yes | Yes |
| Crash logs and diagnostics | Yes (Sentry, Crashlytics) | Yes, to the processor | Analytics, stability | Required | Yes | Via processor |
| Device or other IDs (FCM token) | Yes, if push is enabled | No | Reminders | Optional | Yes | Yes |

Speech note: if the native Android speech recogniser is used on a device that routes audio to Google, the privacy policy and the pre-prompt must say so, and the on-device ONNX engine stays the default whenever it is available. On-device processing means audio is not collected, which should be reflected in the form.

**Release gates tied to policy**

1. Privacy policy, deletion page and takedown contact live and reachable before the first closed-test upload.
2. Data safety and content rating forms submitted and approved on the internal track.
3. App content declarations complete (target audience, ads, news, health, government, financial features, all answered).
4. A reviewer test account with credentials and reproduction notes is added under App access, since parts of the app need sign-in.
5. Every rejection reason from Play is logged with its fix in the repo.

## 7. Non-functional requirements

The app inherits the web budgets in the Hub doc and tightens them for a phone on a mid-range CPU.

| Area | Requirement | How it is checked |
| --- | --- | --- |
| Cold start | Splash to interactive under 2.5 s on a 4 GB mid-range phone, under 4 s on a 2 GB device | Macrobenchmark in CI, Firebase Test Lab |
| Bundle size | Initial JS 225 KB gzip target per route (Home 182.7 KB and Practice Hub 206.4 KB today); AAB under 40 MB before the ONNX model | `npm run size` (`bundle-budget.json`) plus a Gradle size gate |
| On-device model | int8 phoneme model downloaded after install, resumable, SHA-256 verified, kept out of the AAB; use Play Asset Delivery only if the model must ship at install | Manifest `sha256` check (the engine manifest already carries it) |
| Memory | Peak under 300 MB during a take on a 2 GB device; the engine worker is freed when idle for 60 s | Profiler run in the QA matrix |
| Frame rate | At least 55 fps in the highlighter and score ring; jank under 5% | Perfetto traces |
| Battery | No wakelocks outside a take; under 2% battery per 10 minute practice session | Battery Historian |
| API latency | p95 under 400 ms reads, under 600 ms writes (existing stop-ship line) | Sentry and Vercel metrics |
| Availability | 99.5% for the API; clients keep working when it is down | Uptime probe |
| Stability | Crash-free users at least 99.5%, ANR under 0.3% | Android vitals, Crashlytics |

**Security (OWASP MASVS L1, with selected L2 controls)**

- Tokens: store the Supabase session in the Android Keystore backed storage (EncryptedSharedPreferences or a secure-storage plugin), not in plain `localStorage`. Exclude them from Auto Backup and device transfer using `dataExtractionRules`.
- Transport: HTTPS only, certificate transparency, optional public key pinning to the API domain with a backup pin and a remote kill switch so a rotation cannot brick the app.
- WebView hardening: disable file access from file URLs, `setAllowUniversalAccessFromFileURLs(false)`, no `addJavascriptInterface` on untrusted content, `webContentsDebuggingEnabled` only in debug, navigation allow-list limited to the app origin, the API, Supabase, and external links opened in a Custom Tab.
- CSP: carry over the web policy; add the app origin to `connect-src` and keep `wasm-unsafe-eval` for ONNX. Move from report-only to enforced after a clean week (item C6).
- Secrets: no service keys in the client. Only public values (`VITE_SUPABASE_URL`, anon key, Sentry DSN, PostHog key) ship in the bundle.
- Integrity: Play Integrity API check on sensitive calls (leaderboard submit, cloud recording create) to supplement the nonce and spot-check controls (decision D8, D9). Soft-fail for ordinary practice.
- Code protection: R8 shrinking and obfuscation on, source maps uploaded privately to Sentry, debug symbols uploaded to Play.
- Dependency hygiene: Dependabot, `npm audit` and `pip-audit` in CI, SBOM generated per release.
- Logs: never log transcripts, tokens, e-mail or audio; this matches the current Sentry scrubbing rules.

**Privacy and consent**

- Audio and video stay on the device by default; cloud save, spot-check and audio donation each need a separate consent with a version, stored through `POST /me/consents/`.
- Analytics are cookieless and off until the user agrees on first run (a small consent sheet), and also honour the system Do Not Track-like preference where available.
- Minimum age 13: a self-declared age band at first sign-in; under-13 profiles have uploads, sharing and boards disabled.
- Regional rules: GDPR and UK GDPR (consent, access, erasure), India DPDP Act (notice, consent, grievance contact), and CCPA basics. The privacy policy carries a named contact and a grievance officer address.

**Observability**

| Signal | Tool | Notes |
| --- | --- | --- |
| JS errors | Sentry (existing) | Release tagged with `versionName` and `versionCode`, scrubbed |
| Native crashes and ANRs | Firebase Crashlytics and Play Console | Symbols uploaded in CI |
| Product analytics | PostHog (existing, cookieless, consent-gated) | Event allow-list in `web/src/lib/observability/` |
| Performance | Firebase Performance or OpenTelemetry web vitals | Startup, take latency, sync latency |
| Remote config | `GET /api/v1/app-config/` | Minimum version, kill switches, feature flags (extends the existing flag system) |

**Quality gates before any release**

1. Lint, typecheck, unit tests (web 691, API 1387, worker 107 today) and Playwright with axe green.
2. A new Android instrumented suite (Appium or Maestro) covering install, first run, permission flow, offline attempt, sync, deep link, sign out and account deletion.
3. Bundle and AAB size gates pass.
4. No new high or critical findings in dependency and mobile security scans.
5. Pre-launch report has no crashes and no new accessibility errors.

## 8. Release engineering, roadmap and risks

**Repo and build layout.** Add `mobile/` beside `web/` (Capacitor config and the `android/` project) and a `VITE_TARGET=android` build in `web/`. One root script builds the SPA, runs `cap sync android`, and calls Gradle. The web, API and worker stay deployed as they are.

**CI/CD (GitHub Actions)**

1. On every pull request: existing web and API checks, plus an Android debug build, lint, unit tests, and the AAB size gate.
2. On merge to `main`: build a signed release AAB with the upload key from encrypted secrets, upload it to the Play internal track through the Play Developer API (Fastlane supply or Gradle Play Publisher), and attach the mapping file and symbols.
3. On a version tag: promote internal to closed, then production with a staged rollout.
4. Version scheme: `versionName` semantic (1.0.0), `versionCode` monotonic from the CI run number; one source of truth in `mobile/version.json`.

**Release train and rollout**

- Tracks: internal (team, same day), closed (20 or more testers, 14 days), open beta optional, production.
- Production staged rollout 1%, 5%, 20%, 50%, 100%, at least 2 days per step, halting if crash-free users drop below 99.5%, ANR passes 0.47%, the 1-star share jumps by 5 points, or API p95 passes 600 ms. This reuses the stop-ship criteria in the rollout runbook.
- Server compatibility: the API only makes additive changes inside `/v1`. Old app versions must keep working for 90 days after a breaking change; `app-config` can force an update below a minimum `versionCode`.
- Rollback: halt rollout in Play Console, flip server flags (`feature_disabled` is already a supported error), and ship a hotfix with a higher `versionCode`. Over-the-air web updates (Capacitor Live Update or a similar signed bundle service) are allowed only for the JS bundle and must never change declared permissions or data collection; otherwise it risks violating the Play policy on executing downloaded code, so default is store releases only.

**Roadmap**

1. Phase 0, foundation (1 to 2 weeks): SPA build target, Capacitor shell, CORS and CSP changes, Keystore session storage, CI pipeline, internal track build. Gate: app installs and signs in on three physical devices.
2. Phase 1, offline and native (3 to 4 weeks): outbox and sync, local catalogue, native Google sign-in, speech tiers, push, deep links, safe-area and window-size layouts. Gate: all section 5 throttling tests pass.
3. Phase 2, compliance and quality (2 weeks): privacy policy, deletion page, Data safety, content rating, accessibility fixes (C5), pre-launch report, security review. Gate: every row of section 6 evidenced.
4. Phase 3, closed test (2 to 3 weeks, 14 days minimum if a personal account): 20 or more testers, feedback loop, crash fixes. Gate: crash-free at least 99.5%, no open P0 or P1.
5. Phase 4, production (1 week plus rollout): staged rollout to 100%.
6. Phase 5, after launch: Record cloud and share links on Android, widget, in-app review, tablet two-pane polish, Accurate mode once the calibration gate in the speech engine plan is met, iOS through the same Capacitor codebase.

Total is about 9 to 12 weeks for one full-stack engineer plus part-time design and QA; the closed-test window is the fixed minimum.

**Risks**

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Play rejects as a thin web wrapper | Medium | High | Bundled offline app, native plugins, review notes listing native functionality, no remote-only content |
| Web Speech API absent in WebView breaks Speak & score | Certain | High | Tiered speech engines and typed fallback from day one (section 2) |
| Google blocks OAuth in the embedded WebView | Certain | High | Native Credential Manager sign-in, email sign-in as fallback |
| On-device model too large or slow on low-end phones | Medium | Medium | Device gate already in the engine, download after install, fallback to Tier 0 or typed |
| Old or broken System WebView on some OEM builds | Medium | Medium | Minimum-version screen, test on Samsung and Xiaomi builds |
| Battery optimisation kills sync or push on aggressive OEMs | High | Low | WorkManager, FCM high priority only for reminders, in-app explainer for exemptions |
| Data safety form mismatch triggers enforcement | Low | High | Form maintained in the same PR as data changes, quarterly audit |
| 14-day closed-test requirement slips the launch | Medium | Medium | Start recruiting testers in Phase 0; check account type |
| LLM generated twisters produce unsafe content | Low | High | Output moderation, in-app report, flag kill switch, private-only visibility (D25) |
| Privacy exposure from recordings | Low | High | Local-first by default, consent versions, deletion SLA, signed URLs, no public gallery (D2) |

**Open questions**

- Is the Play Console account personal or an organisation account (this decides whether the 12 tester rule applies)?
- Which package name and signing identity (for example `ai.getbreakout.twister`) should be reserved?
- Is native Google sign-in required for 1.0, or is email and password enough for the first release?
- Does the speech accuracy gate on en-IN speakers pass before launch, or does 1.0 ship with the text layer and typed fallback only?
- Is iOS a committed follow-up, so that plugin choices should favour cross-platform options now?

## Sources

Repository documents: `docs/PRD.md`, `docs/ERD.md`, `docs/ARCHITECTURE.md`, `docs/features/00-overview-and-roadmap.md`, `docs/features/07-api-contract.md`, `docs/features/11-decisions-log.md`, `docs/features/12-implementation-status.md`, `docs/features/15-rollout-and-flags.md`. Play requirements checked on 2026-10-03: [target API level](https://developer.android.com/google/play/requirements/target-sdk), [testing requirement for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en), [account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-GB).
