// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '#/lib/api'
import {
  classifyUnsubscribeError,
  clampHour,
  getReminders,
  putReminders,
  unsubscribe,
} from './api'

vi.mock('#/lib/supabase', () => ({ getAccessToken: async () => null }))
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
afterEach(() => vi.unstubAllGlobals())

describe('reminders api', () => {
  it('GET normalises the payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ enabled: true, hour_local: 99 })),
    )
    expect(await getReminders()).toEqual({ enabled: true, hour_local: 23 })
  })
  it('PUT sends only enabled and a clamped hour', async () => {
    const f = vi.fn().mockResolvedValue(json({ enabled: false, hour_local: 7 }))
    vi.stubGlobal('fetch', f)
    await putReminders({ enabled: false, hour_local: 7.9 })
    const [url, init] = f.mock.calls[0]
    expect(url).toMatch(/\/api\/v1\/me\/reminders\/$/)
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ enabled: false, hour_local: 7 })
  })
  it('unsubscribe POSTs the encoded token without credentials', async () => {
    const f = vi.fn().mockResolvedValue(json({ unsubscribed: true }))
    vi.stubGlobal('fetch', f)
    await unsubscribe('a:b/c')
    const [url, init] = f.mock.calls[0]
    expect(url).toMatch(/\/public\/unsubscribe\/a%3Ab%2Fc\/$/)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).has('Authorization')).toBe(false)
  })
  it('classifies failures', () => {
    expect(classifyUnsubscribeError(new ApiError(404, 'x'))).toBe('invalid')
    expect(classifyUnsubscribeError(new ApiError(400, 'x'))).toBe('invalid')
    expect(classifyUnsubscribeError(new ApiError(500, 'x'))).toBe('error')
    expect(classifyUnsubscribeError(new TypeError('fetch failed'))).toBe(
      'network',
    )
    expect(clampHour(-3)).toBe(0)
    expect(clampHour('x')).toBe(18)
  })
})
