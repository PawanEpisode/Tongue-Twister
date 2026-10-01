import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '#/lib/api'
import {
  deleteMyTwister,
  generateTwister,
  listMyTwisters,
  normaliseList,
} from './api'

vi.mock('#/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: { access_token: 'tok' } } }),
    },
  },
}))

const fetchMock = vi.fn()
beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status })

describe('generate api', () => {
  it('POSTs the topic with auth', async () => {
    fetchMock.mockResolvedValue(json(201, { slug: 'x', text: 'T' }))
    const t = await generateTwister({ topic: 'otters', difficulty: 2 })
    expect(t.slug).toBe('x')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/v1\/generate\/$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      topic: 'otters',
      difficulty: 2,
    })
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok')
  })
  it('throws ApiError with the envelope code', async () => {
    fetchMock.mockResolvedValue(
      json(429, { error: { code: 'generation_limit' } }),
    )
    await expect(generateTwister({ topic: 'x' })).rejects.toMatchObject({
      status: 429,
      code: 'generation_limit',
    })
    fetchMock.mockResolvedValue(json(503, {}))
    await expect(generateTwister({ topic: 'x' })).rejects.toBeInstanceOf(
      ApiError,
    )
  })
  it('lists from a page or a bare array', async () => {
    expect(normaliseList({ count: 1, results: [{ slug: 'a' }] })).toHaveLength(
      1,
    )
    expect(normaliseList([{ slug: 'a' }])).toHaveLength(1)
    expect(normaliseList(null)).toEqual([])
    fetchMock.mockResolvedValue(json(200, { count: 0, results: [] }))
    expect(await listMyTwisters()).toEqual([])
  })
  it('DELETEs and tolerates 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await deleteMyTwister(12)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/me\/twisters\/12\/$/)
    expect(init.method).toBe('DELETE')
  })
})
