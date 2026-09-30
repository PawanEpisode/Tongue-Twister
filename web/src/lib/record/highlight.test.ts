import { describe, expect, it } from 'vitest'
import { HitTimes, buildTextLayer } from './highlight'

const words = ['peter', 'piper', 'picked']
const input = {
  paceIndex: 1,
  paceActive: true,
  hits: [true, false, false],
  speechIndex: 1,
}

describe('buildTextLayer', () => {
  it('pacing follows the Read-along index and shows no speech hits', () => {
    expect(buildTextLayer(words, 'pacing', input)).toEqual({
      words,
      current: 1,
      hits: [],
    })
  })
  it('pacing shows nothing before it has started', () => {
    expect(
      buildTextLayer(words, 'pacing', { ...input, paceActive: false }).current,
    ).toBe(-1)
  })
  it('speech follows the matcher and marks said words', () => {
    expect(buildTextLayer(words, 'speech', { ...input, paceIndex: 2 })).toEqual(
      {
        words,
        current: 1,
        hits: [true, false, false],
      },
    )
  })
  it('both: pace guide for the highlight, speech for the ticks', () => {
    const t = buildTextLayer(words, 'both', { ...input, speechIndex: 0 })
    expect(t.current).toBe(1)
    expect(t.hits).toEqual([true, false, false])
  })
})

describe('HitTimes', () => {
  it('records the first time each word was reached and never overwrites it', () => {
    const h = new HitTimes(3)
    expect(h.observe([false, false, false], 100)).toBe(false)
    expect(h.observe([true, false, false], 400)).toBe(true)
    expect(h.observe([true, true, false], 900)).toBe(true)
    expect(h.observe([true, true, false], 1200)).toBe(false)
    expect(h.times).toEqual([400, 900, -1])
    h.reset()
    expect(h.times).toEqual([-1, -1, -1])
  })
})
