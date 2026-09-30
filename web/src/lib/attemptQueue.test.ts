import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import type { AttemptSyncResult, SubmitAttemptBody } from './api'
import {
  BATCH_SIZE,
  MAX_QUEUED,
  attemptQueue,
  flushAttemptQueue,
  isTransient,
} from './attemptQueue'

function stubStorage() {
  const data = new Map<string, string>()
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    },
  })
  return data
}

let n = 0
const body = (over: Partial<SubmitAttemptBody> = {}): SubmitAttemptBody => ({
  client_attempt_id: `id-${++n}`,
  twister: 'peter-piper',
  transcript: 'peter piper',
  duration_ms: 2000,
  ...over,
})
const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i))
const reply = (items: SubmitAttemptBody[]): AttemptSyncResult => ({
  results: items.map((b) => ({
    client_attempt_id: b.client_attempt_id,
    status: 'created' as const,
  })),
  counts: { created: items.length, duplicate: 0, rejected: 0 },
  profile: { xp: 1, level: 1, current_streak: 1, best_streak: 1 },
})

beforeEach(() => {
  stubStorage()
})

describe('attemptQueue', () => {
  it('keeps attempts per user, oldest first, without duplicates', () => {
    const a = body()
    attemptQueue.add('u1', body(), at(5))
    attemptQueue.add('u1', a, at(1))
    attemptQueue.add('u1', a, at(2)) // same client_attempt_id: ignored
    attemptQueue.add('u2', body(), at(3))
    const mine = attemptQueue.pending('u1')
    expect(mine).toHaveLength(2)
    expect(mine[0].client_attempt_id).toBe(a.client_attempt_id)
    expect(attemptQueue.pending('u2')).toHaveLength(1)
  })

  it('caps the queue and drops the oldest', () => {
    for (let i = 0; i < MAX_QUEUED + 5; i++)
      attemptQueue.add('u', body(), at(i))
    expect(attemptQueue.pending('u')).toHaveLength(MAX_QUEUED)
  })

  it('survives corrupt storage', () => {
    window.localStorage.setItem('twister.attempts.v1', '{nope')
    expect(attemptQueue.pending('u')).toEqual([])
  })
})

describe('flushAttemptQueue', () => {
  it('uploads in batches of 50 and empties the queue', async () => {
    for (let i = 0; i < BATCH_SIZE + 3; i++)
      attemptQueue.add('u', body(), at(i))
    const send = vi.fn(async (items: SubmitAttemptBody[]) => reply(items))
    const r = await flushAttemptQueue('u', send)
    expect(send.mock.calls.map((c) => c[0].length)).toEqual([BATCH_SIZE, 3])
    expect(r.uploaded).toBe(BATCH_SIZE + 3)
    expect(attemptQueue.pending('u')).toHaveLength(0)
  })

  it('never sends another account’s attempts or the local user_id', async () => {
    attemptQueue.add('other', body(), at(1))
    attemptQueue.add('u', body(), at(2))
    const send = vi.fn(async (items: SubmitAttemptBody[]) => reply(items))
    await flushAttemptQueue('u', send)
    expect(send.mock.calls[0][0]).toHaveLength(1)
    expect(send.mock.calls[0][0][0]).not.toHaveProperty('user_id')
    expect(attemptQueue.pending('other')).toHaveLength(1)
  })

  it('keeps everything when offline or throttled', async () => {
    attemptQueue.add('u', body(), at(1))
    for (const err of [
      new TypeError('offline'),
      new ApiError(503, 'x'),
      new ApiError(429, 'throttled'),
    ]) {
      await flushAttemptQueue('u', () => Promise.reject(err))
      expect(attemptQueue.pending('u')).toHaveLength(1)
    }
  })

  it('drops a batch the server calls malformed so it cannot block the queue', async () => {
    attemptQueue.add('u', body(), at(1))
    await flushAttemptQueue('u', () =>
      Promise.reject(new ApiError(400, 'validation_error')),
    )
    expect(attemptQueue.pending('u')).toHaveLength(0)
  })

  it('shares one run between concurrent callers', async () => {
    attemptQueue.add('u', body(), at(1))
    const send = vi.fn(async (items: SubmitAttemptBody[]) => reply(items))
    await Promise.all([
      flushAttemptQueue('u', send),
      flushAttemptQueue('u', send),
    ])
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('isTransient', () => {
  it('classifies errors', () => {
    expect(isTransient(new TypeError('fetch failed'))).toBe(true)
    expect(isTransient(new ApiError(401, 'x'))).toBe(true)
    expect(isTransient(new ApiError(400, 'x'))).toBe(false)
    expect(isTransient(new ApiError(422, 'x'))).toBe(false)
  })
})
