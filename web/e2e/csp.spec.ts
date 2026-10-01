/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { TWISTER } from './fixtures'
import { API_ORIGIN } from './support/apiServer'
import { openApp } from './support/setup'

type Header = { key: string; value: string }
const vercel = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as {
  headers: { source: string; headers: Header[] }[]
}
const siteHeaders =
  vercel.headers.find((h) => h.source === '/(.*)')?.headers ?? []
const header = (key: string) =>
  siteHeaders.find((h) => h.key === key)?.value ?? ''

type Violation = {
  directive: string
  blocked: string
  disposition: string
  sample: string
}

/**
 * Vercel applies vercel.json headers at its edge, so the local Nitro server does not send them. To judge the
 * policy against the real built app, add the production CSP to every document response here, then collect
 * the browser's `securitypolicyviolation` events (report-only violations fire them too).
 */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: Violation[] }
    w.__csp = []
    document.addEventListener('securitypolicyviolation', (e) =>
      w.__csp.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI,
        disposition: e.disposition,
        sample: e.sample.slice(0, 80),
      }),
    )
  })
  await page.route('**/*', async (route) => {
    const req = route.request()
    if (req.resourceType() !== 'document') return route.fallback()
    const res = await route.fetch()
    await route.fulfill({
      response: res,
      headers: {
        ...res.headers(),
        'content-security-policy-report-only': policy,
      },
    })
  })
}

/**
 * vercel.json cannot know the API origin, so production adds it to `connect-src` by hand (docs/runbooks/web-ci.md).
 * The test does the same with the local mock API's origin, so it checks every other directive for real.
 */
const policy = header('Content-Security-Policy-Report-Only').replace(
  "connect-src 'self'",
  `connect-src 'self' ${API_ORIGIN}`,
)

const violations = (page: Page) =>
  page.evaluate(() => (window as unknown as { __csp: Violation[] }).__csp)

/**
 * Violations that are understood and accepted for the report-only phase. Each needs a reason; anything not
 * listed here fails the test, so a new violation (or a new third-party host) cannot slip in unnoticed.
 */
const KNOWN: { directive: string; blocked: string; reason: string }[] = []

test('the production CSP (report-only) sees no unexpected violations across the app', async ({
  page,
}) => {
  expect(header('Content-Security-Policy-Report-Only')).toContain(
    "default-src 'self'",
  )
  expect(header('Content-Security-Policy')).toBe('') // report-only: it must not enforce yet

  await openApp(page, { speech: TWISTER.text })
  await watchViolations(page)
  const seen: Violation[] = []
  const collect = async () => seen.push(...(await violations(page)))

  for (const path of [
    '/',
    '/twisters',
    `/twisters/${TWISTER.slug}?mode=read`,
    '/stats',
    '/favorites',
    '/login',
  ]) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    await collect()
  }

  // Speak: mic, analyser, the pulse animation (Lottie) and the result card.
  await page.goto(`/twisters/${TWISTER.slug}?mode=speak`)
  await page.getByRole('button', { name: 'Start speaking' }).click()
  await expect(page.getByText('6 of 6 words correct')).toBeVisible({
    timeout: 20_000,
  })
  await collect()

  // Record: camera preview, canvas + MediaRecorder + the frame-clock worker (blob:).
  await page.goto(`/twisters/${TWISTER.slug}?mode=record`)
  await page.getByRole('button', { name: 'Start camera' }).click()
  await expect(
    page.getByRole('button', { name: 'Record', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Record', exact: true }).click()
  await expect(
    page.getByRole('progressbar', { name: 'Recording time used' }),
  ).toBeVisible({ timeout: 15_000 })
  await collect()

  const unique = [
    ...new Map(seen.map((v) => [`${v.directive}|${v.blocked}`, v])).values(),
  ]
  test.info().annotations.push(
    ...unique.map((v) => ({
      type: 'csp-violation',
      description: `${v.directive} blocked ${v.blocked} ${v.sample}`,
    })),
  )
  const unexpected = unique.filter(
    (v) =>
      !KNOWN.some(
        (k) => k.directive === v.directive && k.blocked === v.blocked,
      ),
  )
  expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([])
  expect(unique.every((v) => v.disposition === 'report')).toBe(true)
})
