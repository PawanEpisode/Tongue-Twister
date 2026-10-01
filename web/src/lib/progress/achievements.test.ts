import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnlockedAchievement } from '../api'
import {
  createSeenBatcher,
  dismiss,
  emptyToasts,
  enqueue,
} from './achievements'

const a = (code: string): UnlockedAchievement => ({
  code,
  name: code,
  description: '',
  icon: 'trophy',
  tier: 'bronze',
  xp_reward: 10,
})

describe('toast queue', () => {
  it('queues new unlocks in order', () => {
    const s = enqueue(emptyToasts(), [a('x'), a('y')])
    expect(s.queue.map((q) => q.code)).toEqual(['x', 'y'])
  })
  it('dedupes across the response and the summary', () => {
    const fromResponse = enqueue(emptyToasts(), [a('x')])
    const fromSummary = enqueue(fromResponse, [a('x'), a('z')])
    expect(fromSummary.queue.map((q) => q.code)).toEqual(['x', 'z'])
  })
  it('dedupes within one batch', () => {
    expect(enqueue(emptyToasts(), [a('x'), a('x')]).queue).toHaveLength(1)
  })
  it('does not re-queue a code that was already shown and dismissed', () => {
    let s = enqueue(emptyToasts(), [a('x')])
    s = dismiss(s, 'x')
    expect(s.queue).toHaveLength(0)
    // the summary still lists it until the seen call lands
    expect(enqueue(s, [a('x')]).queue).toHaveLength(0)
  })
  it('returns the same state when nothing changes', () => {
    const s = enqueue(emptyToasts(), [a('x')])
    expect(enqueue(s, [a('x')])).toBe(s)
    expect(dismiss(s, 'nope')).toBe(s)
  })
})

describe('createSeenBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends one request for a burst', async () => {
    const flush = vi.fn().mockResolvedValue(undefined)
    const b = createSeenBatcher(flush, 500)
    b.add('x')
    b.add('y')
    b.add('x')
    await vi.advanceTimersByTimeAsync(499)
    expect(flush).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledWith(['x', 'y'])
  })
  it('flushNow sends immediately and the timer does not fire twice', async () => {
    const flush = vi.fn().mockResolvedValue(undefined)
    const b = createSeenBatcher(flush, 500)
    b.add('x')
    await b.flushNow()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(flush).toHaveBeenCalledTimes(1)
  })
  it('retries codes from a failed flush with the next batch', async () => {
    const flush = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined)
    const b = createSeenBatcher(flush, 100)
    b.add('x')
    await vi.advanceTimersByTimeAsync(150)
    b.add('y')
    await vi.advanceTimersByTimeAsync(150)
    expect(flush).toHaveBeenLastCalledWith(['x', 'y'])
  })
})
