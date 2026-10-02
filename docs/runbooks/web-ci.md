# Web CI, security headers and budgets

Operational notes for the web app (`web/`). Everything here runs from `web/`. Spec: the retired round-1 spec (git history).

## Commands

| Command | What it does | Needs |
| --- | --- | --- |
| `npm run lint` / `npm run check` / `npm test` | ESLint; Prettier + `tsc --noEmit`; Vitest | nothing |
| `npm run test:scripts` | unit tests for the build scripts (`node --test`) | nothing |
| `npm run build` then `npm run size` | production build, then the bundle-size budget | nothing |
| `npm run e2e:install` | `playwright install --with-deps chromium` (once per machine / CI run) | internet |
| `npm run test:e2e` | functional specs + the CSP spec, Chromium with fake camera/mic | Chromium |
| `npm run test:a11y` | axe checks, light and dark theme | Chromium |
| `npm run build:e2e` | build the app against the mock API (the e2e commands do this for you) | nothing |

`test:e2e` and `test:a11y` build the app first (`scripts/build-e2e.mjs`), start the Nitro server on `127.0.0.1:4173` and a mock API on `127.0.0.1:4010`, then run. Set `E2E_SKIP_BUILD=1` to reuse the existing `.output`. Override the ports with `E2E_PORT` and `E2E_API_PORT`. The e2e build overwrites `.output`; run `npm run build` again if you need the real-env build.

The suite needs no backend and no Supabase. The build points `VITE_API_URL` at the mock API and gives Supabase inert values (nothing listens there, there is never a session), so only guests are exercised. Browser calls are answered per test by `page.route` (`e2e/support/mockApi.ts`); the mock HTTP server only exists because route loaders also run in Node during server-side rendering, where `page.route` cannot see them. Both use the one router in `e2e/support/router.ts`. Fixtures (`e2e/fixtures/`) are typed with `satisfies` against `src/lib/api.ts`, so an API type change fails `tsc`.

Machines where `playwright install` cannot download a browser: set `E2E_CHROMIUM_PATH` to a Chromium binary and `E2E_CHROMIUM_ARGS` for extra flags (for example `--no-sandbox --no-zygote --disable-gpu` in a container).

### What the specs cover

- `home`, `browse` (filter chips change the request parameters and the list), `guest` (`/stats`, `/favorites` prompts).
- `modes`: Read along, Speak, Record, back, asserting zero live media tracks after each switch (streams from `getUserMedia`, `getDisplayMedia`, `canvas.captureStream` and the audio graph are tracked by `e2e/support/media.ts`).
- `record`: fake camera, camera_text layout, a 2 second take, review screen, Download enabled, camera released.
- `offline`: offline during Speak; the take is scored locally and written to the guest queue (`twister.guest.v1`). Signed-in offline queueing (`twister.attempts.v1`) needs a session and is covered by the Vitest suite (`attemptQueue.test.ts`), not here.
- `a11y`: axe on home, browse, twister (read / speak / record), stats, favorites, login, shared score card, in light and dark. Fails on `serious` and `critical` only. Animations are reduced (`reducedMotion: 'reduce'`) so mid-animation colours are not measured.
- `csp`: see below.

### Known accessibility findings

`e2e/known-a11y.json` lists pre-existing findings that need a design decision. Each entry excludes one rule on one selector and carries a reason; never disable a rule wholesale. Fix the issue, then delete the entry. The list is empty as of Round 4.

## Adding the commands to CI

**Wired in Round 4** in `.github/workflows/ci.yml` (the YAML below is what is there; the e2e job also caches `~/.cache/ms-playwright` keyed on `web/package-lock.json` and uploads `web/test-results` as well). Keep this section and the workflow in step.

In the existing `web` job, after `npm test`:

```yaml
      - run: npm run test:scripts
      - run: npm run build
      - run: npm run size
```

A new job (it builds with the mock API, so it does not reuse the `web` job's `.output`):

```yaml
  web-e2e:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: web/package-lock.json
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - run: npm run test:a11y
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            web/playwright-report
            web/e2e/.results
          retention-days: 7
```

`CI=true` (set by Actions) turns on one retry, two workers, the HTML report and `forbidOnly`, and stops Playwright reusing a stale server. Traces are kept for failed tests in `web/e2e/.results`.

## Content-Security-Policy (report-only)

`web/vercel.json` sends `Content-Security-Policy-Report-Only` plus `Permissions-Policy`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and `Strict-Transport-Security` on every route. The CSP does not block anything yet; browsers only log what it would have blocked. The headers are applied by Vercel, so `vite preview` and the local Nitro server do not send them.

Why the policy has these exceptions:

- `script-src 'self' 'unsafe-inline'`: TanStack Start inlines its bootstrap and dehydration scripts into the server-rendered HTML, and the theme boot script and JSON-LD are inline too. Follow-up: a per-request nonce (needs a Nitro middleware that sets it and passes it to the router), then drop `'unsafe-inline'`.
- `style-src 'unsafe-inline'`: React `style` attributes (progress bars, motion) and Tailwind runtime values. Google Fonts CSS is allowed; the font files come from `fonts.gstatic.com`.
- `worker-src blob:`: the Record-mode frame clock is a bundled worker created from a blob.
- `media-src blob: mediastream:`, `img-src blob: data:`: local recording playback and thumbnails.
- `connect-src`: `'self'`, `https://*.vercel.app` (API on a Vercel domain), `https://*.supabase.co` and `wss://*.supabase.co`. **If the API is served from a custom domain, add its origin to `connect-src` in `vercel.json` before flipping to enforcing.** This is the only value the file cannot know. Round 2 (2026-10-01) added `https://*.i.posthog.com`, `https://*.ingest.sentry.io`, `https://*.ingest.us.sentry.io` and `https://*.ingest.de.sentry.io`. **These hosts depend on region and environment**: the Sentry ingest host is the one in your DSN (`https://<key>@oNNN.ingest.<region>.sentry.io/<project>`), and PostHog is `eu.i.posthog.com` or `us.i.posthog.com` (set by `VITE_POSTHOG_HOST`). A self-hosted or reverse-proxied host, or a Sentry region not listed, must be added to `connect-src` before flipping to enforcing. No `script-src` change is needed: session replay, surveys and autocapture are off, so PostHog loads no remote scripts.
- `object-src 'none'` is an addition to the spec's list (no plugins are used).

### Measured against the built app

The `csp` spec loads the built app with the production policy added to every document response, drives every page plus Speak and a Record take, and fails on any violation it does not know. Result on 2026-10-01: **no violations**, with the API origin appended to `connect-src` the way production must. Checked sensitivity: removing `'unsafe-inline'` from `script-src` or `blob:` from `worker-src` makes it fail, so it does detect violations. Not triggered by anything the suite reaches: Lottie `eval` (the pulse animation did not need it), the Google Fonts request (blocked in tests to keep them hermetic, so the real font URLs are unverified against the policy), Supabase sign-in traffic (no session in tests).

### Reading violations in production

1. Open the site in Chrome, DevTools → Console, filter "Content Security Policy" (report-only messages say "[Report Only]"). Or `Issues` tab → "Content security policy".
2. Walk the main flows signed in: sign in with email and with Google, Practice (all four modes), Record with cloud save, `/recordings`, a public `/r/<token>` page.
3. Every message names the blocked URL and the directive. A third-party host you want: add it to that directive. Something you do not recognise: find where it comes from before allowing it.
4. Round 4 adds a CSP report endpoint on the API (see the api-fix notes in `docs/features/12-implementation-status.md`); wiring `report-uri` in `vercel.json` to it is the remaining step.

### Flipping to enforcing

1. At least a week of clean consoles on production across the flows above (or a collector with zero new reports).
2. In `vercel.json` rename the header key `Content-Security-Policy-Report-Only` to `Content-Security-Policy`. Keep the report-only copy too for a while if you are tightening something (a stricter policy in report-only beside the enforcing one is allowed).
3. Deploy to a preview, repeat the flows, then promote. Rollback is reverting that one line.
4. The `csp` spec asserts there is no enforcing `Content-Security-Policy` header; change that assertion in the same commit.

## Bundle-size budget

`scripts/check-bundle-size.mjs` reads the Nitro build (`.output`): the TanStack Start manifest lists the chunks each route preloads; the script adds everything those chunks statically import, gzips each (level 9) and sums. Dynamic imports (the Record-mode chunk, Lottie, confetti, tus) are not first load. Budgets live in `bundle-budget.json`: `maxGzipKB` per route is the enforced ratchet, `targetGzipKB` is the product target (doc 00 §6.3: 225 KB for the Practice Hub).

State on 2026-10-02 after Round 5: Home 182.7 KB, Practice Hub 206.4 KB (Round 4: 193.1 and 230.1; before: 282.1 and 318.9), both **under the 225 KB target**; the ratchet is current + 5 % (192 and 217). Round 5 deferred the motion feature set (`motionFeatures.ts`) and lazy-loaded the mobile nav, user menu, weekly board and the non-default practice modes. When a change makes a route smaller, lower its `maxGzipKB`. Never raise it to make a build pass.

What Round 4 changed, and the rules that keep it small:

- `@supabase/supabase-js` (~53 KB gz) is a dynamic import in `src/lib/supabase.ts`. Guests never load it: `AuthProvider` and `getAccessToken()` only load it when `mayHaveSession()` finds a stored session (`sb-*-auth-token*` in localStorage, which includes a PKCE verifier mid sign-in) or a sign-in redirect in the URL, and the login page and Sign out load it on use. Never `import { createClient }` or a runtime value from `@supabase/supabase-js` anywhere else (`import type` is fine).
- Animations use `m` from `motion/react` inside `LazyMotion` + `domAnimation` (`components/MotionProvider.tsx`, `strict`). Do not import `motion` for components; drag and layout animation would need `domMax`.
- The Radix dropdown (~27 KB gz) is behind `ThemeMenu` (a plain button until pressed, then the real menu from `ThemeMenuImpl`). Other dropdowns live in route chunks; keep `ui/dropdown-menu` out of anything the header or root imports.

Remaining first-load: the app entry chunk (~135 KB gz: `react-dom`, TanStack Router core, seroval, query), then small shared chunks. Going much lower needs a decision on the router/SSR payload.

## Observability (Round 2, D28)

`src/lib/observability/`: `sentry.ts`, `analytics.ts` (PostHog), `consent.ts` (opt-out, Do-Not-Track), `events.ts` (the single event allow-list). Both vendors are dynamic imports behind an env check, so **without `VITE_SENTRY_DSN` / `VITE_POSTHOG_KEY` nothing is fetched or executed**: the `@sentry/react` and `posthog-js` chunks exist in `.output` but no page loads them, and they are not in any route's first-load budget. Variables are documented in `web/.env.example`; they are public client values, set per Vercel environment (leave them unset on previews if you don't want preview noise).

- Adding an event: declare it in `EVENT_RULES` and `EventProps` in `events.ts`. Properties are closed enums or small numbers; anything else is dropped by `sanitise`. Never add free text, ids, emails or transcripts.
- PostHog runs cookieless (`persistence: 'memory'`), with no autocapture, pageview capture or session replay, and respects Do-Not-Track. `/account` > Privacy stores an opt-out in `localStorage` (`twister.analytics.optout.v1`); it stops a running client immediately.
- Sentry events pass `scrubEvent`: no user, cookies, headers, request bodies or query strings; emails and token-like strings are redacted; console breadcrumbs are dropped; replay and tracing are off.
- Budget check: run `npm run build && npm run size` after touching any of these files. The eager glue (wrappers, consent hook) cost about 1.4 KB gzip on 2026-10-01 (Home 280.6 to 281.9 KB, Practice Hub 317.2 to 318.6 KB); the vendor SDKs must stay lazy. If `size` jumps by tens of KB, a static `import 'posthog-js'` or `'@sentry/react'` has crept in. The ratchet in `bundle-budget.json` was not raised.
- Reminders and unsubscribe: `/account` > Reminders is gated by the `reminders` flag; `/unsubscribe/$token` is public, `noindex`, and only calls `POST /public/unsubscribe/{token}/` when the button is pressed (mail scanners that prefetch the link cannot unsubscribe anyone).
