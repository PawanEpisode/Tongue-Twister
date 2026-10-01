// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetSentry,
  __setSentryLoader,
  initSentry,
  scrubEvent,
  scrubText,
  scrubUrl,
} from './sentry'

beforeEach(() => __resetSentry())
afterEach(() => vi.unstubAllEnvs())

describe('sentry', () => {
  it('without a DSN: nothing is loaded', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '')
    const loader = vi.fn()
    __setSentryLoader(loader)
    initSentry()
    expect(loader).not.toHaveBeenCalled()
  })

  it('with a DSN: inits once with replay off and a scrubbing beforeSend', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://k@o1.ingest.sentry.io/1')
    const init = vi.fn()
    __setSentryLoader(() => Promise.resolve({ init } as never))
    initSentry()
    initSentry()
    await new Promise((r) => setTimeout(r, 0))
    expect(init).toHaveBeenCalledTimes(1)
    const opts = init.mock.calls[0][0]
    expect(opts.dsn).toBe('https://k@o1.ingest.sentry.io/1')
    expect(opts.replaysSessionSampleRate).toBe(0)
    expect(opts.tracesSampleRate).toBe(0)
    expect(typeof opts.beforeSend).toBe('function')
  })

  it('scrubs PII', () => {
    expect(scrubText('failed for ana@example.com')).toBe('failed for [email]')
    expect(scrubUrl('https://t.app/s/abc?code=secret#x')).toBe(
      'https://t.app/s/abc',
    )
    const e = scrubEvent({
      user: { email: 'a@b.co', ip_address: '1.2.3.4' },
      extra: { transcript: 'hello' },
      request: {
        url: 'https://t.app/r/tok?x=1',
        headers: { cookie: 'a' },
        cookies: { a: 1 },
      },
      message: 'user a@b.co broke it',
      exception: { values: [{ value: 'bad ana@example.com' }] },
      breadcrumbs: [
        { message: 'nav', data: { to: '/r/abc?t=1', body: 'secret' } },
      ],
    })
    expect(e.user).toBeUndefined()
    expect(e.extra).toBeUndefined()
    expect(e.request).toEqual({ url: 'https://t.app/r/tok' })
    expect(e.message).toBe('user [email] broke it')
    expect(e.exception?.values?.[0].value).toBe('bad [email]')
    expect(e.breadcrumbs?.[0].data).toEqual({ to: '/r/abc' })
  })
})
