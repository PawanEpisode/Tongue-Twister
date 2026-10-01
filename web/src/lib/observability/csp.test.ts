// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const vercel = JSON.parse(
  readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8'),
) as { headers: { headers: { key: string; value: string }[] }[] }
const csp =
  vercel.headers[0].headers.find(
    (h) => h.key === 'Content-Security-Policy-Report-Only',
  )?.value ?? ''
const directive = (name: string) =>
  csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `)) ?? ''

describe('CSP for observability hosts', () => {
  it('allows PostHog and Sentry ingest in connect-src only', () => {
    const connect = directive('connect-src')
    for (const host of [
      'https://*.i.posthog.com',
      'https://*.ingest.sentry.io',
      'https://*.ingest.us.sentry.io',
      'https://*.ingest.de.sentry.io',
    ])
      expect(connect).toContain(host)
    expect(directive('script-src')).not.toMatch(/posthog|sentry/)
  })
})
