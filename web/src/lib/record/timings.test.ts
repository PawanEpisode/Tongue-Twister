import { describe, expect, it } from 'vitest'
import { SPEECH_LAG_MS, resolveTimings } from './timings'

const words = ['peter', 'piper', 'picked', 'a', 'peck']

describe('resolveTimings', () => {
  it('spreads words evenly when nothing else is known', () => {
    const t = resolveTimings({ words, durationMs: 5000 })
    expect(t.map((x) => x.startMs)).toEqual([0, 1000, 2000, 3000, 4000])
    expect(t.at(-1)?.endMs).toBe(5000)
  })
  it('uses the Read-along schedule when pacing', () => {
    const t = resolveTimings({
      words,
      paceStarts: [0, 400, 900, 1500, 1700],
      durationMs: 3000,
    })
    expect(t.map((x) => x.startMs)).toEqual([0, 400, 900, 1500, 1700])
    expect(t[0].endMs).toBe(400)
  })
  it('prefers speech hits (shifted earlier by the recogniser lag) and fills gaps', () => {
    const t = resolveTimings({
      words,
      hitTimes: [1000, -1, 2200, 2600, 3400],
      durationMs: 4000,
    })
    expect(t[0].startMs).toBe(1000 - SPEECH_LAG_MS)
    expect(t[2].startMs).toBe(2200 - SPEECH_LAG_MS)
    // the unreached word sits between its neighbours
    expect(t[1].startMs).toBeGreaterThan(t[0].startMs)
    expect(t[1].startMs).toBeLessThan(t[2].startMs)
  })
  it('ignores speech hits when too few words were matched', () => {
    const t = resolveTimings({
      words,
      hitTimes: [500, -1, -1, -1, -1],
      paceStarts: [0, 100, 200, 300, 400],
      durationMs: 1000,
    })
    expect(t.map((x) => x.startMs)).toEqual([0, 100, 200, 300, 400])
  })
  it('keeps times ascending and inside the take, even for noisy hits', () => {
    const t = resolveTimings({
      words,
      hitTimes: [3000, 1000, 2000, 9000, 500],
      durationMs: 4000,
    })
    for (let i = 1; i < t.length; i++)
      expect(t[i].startMs).toBeGreaterThanOrEqual(t[i - 1].startMs)
    expect(Math.max(...t.map((x) => x.endMs))).toBeLessThanOrEqual(4000)
  })
  it('returns nothing for an empty twister or take', () => {
    expect(resolveTimings({ words: [], durationMs: 1000 })).toEqual([])
    expect(resolveTimings({ words, durationMs: 0 })).toEqual([])
  })
})
