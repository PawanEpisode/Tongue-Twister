import { describe, expect, it } from 'vitest'
import { analyseTake, deliveryHints } from './analysis'

const base = {
  text: 'Peter Piper picked a peck',
  difficulty: 2,
  focusSounds: ['p'],
  durationMs: 5000,
}

describe('analyseTake', () => {
  it('scores a speech-driven take and puts mistake markers where the words were', () => {
    const a = analyseTake({
      ...base,
      stored: {
        transcript: 'peter piper picked a',
        longPauseMs: 0,
        hitTimes: [500, 1000, 1800, 2400, -1],
        paceStarts: null,
      },
      spokenMs: 3000,
    })
    expect(a.scored).toBe(true)
    expect(a.score).toBeGreaterThan(0)
    expect(a.statuses).toHaveLength(5)
    expect(a.statuses[4]).toBe('missed')
    expect(a.markers.map((m) => m.word)).toContain('peck')
    expect(a.cues.length).toBeGreaterThan(0)
  })
  it('a pacing-only take has captions but no score and no markers', () => {
    const a = analyseTake({
      ...base,
      stored: {
        transcript: '',
        longPauseMs: 0,
        hitTimes: [],
        paceStarts: [0, 900, 1800, 2700, 3200],
      },
    })
    expect(a.scored).toBe(false)
    expect(a.markers).toEqual([])
    expect(a.timings.map((t) => t.startMs)).toEqual([0, 900, 1800, 2700, 3200])
    expect(a.cues.length).toBeGreaterThan(0)
  })
  it('a take with no analysis at all still gets evenly spread captions', () => {
    const a = analyseTake({ ...base, stored: null })
    expect(a.scored).toBe(false)
    expect(a.timings).toHaveLength(5)
  })
})

describe('deliveryHints', () => {
  it('compares pace with the target', () => {
    expect(
      deliveryHints({
        wpm: 160,
        targetWpm: 130,
        longPauseMs: 0,
        transcript: '',
      }).pace,
    ).toMatch(/little fast/)
    expect(
      deliveryHints({
        wpm: 100,
        targetWpm: 130,
        longPauseMs: 0,
        transcript: '',
      }).pace,
    ).toMatch(/steady/)
    expect(
      deliveryHints({
        wpm: 130,
        targetWpm: 130,
        longPauseMs: 0,
        transcript: '',
      }).pace,
    ).toMatch(/on pace/)
    expect(
      deliveryHints({ wpm: 0, targetWpm: 130, longPauseMs: 0, transcript: '' })
        .pace,
    ).toBeNull()
  })
  it('reports the longest pause only when it is noticeable, and counts fillers', () => {
    const h = deliveryHints({
      wpm: 120,
      targetWpm: 120,
      longPauseMs: 1450,
      transcript: 'um peter piper uh picked',
    })
    expect(h.longestPauseS).toBe(1.5)
    expect(h.fillers).toBe(2)
    expect(
      deliveryHints({ wpm: 1, targetWpm: 1, longPauseMs: 300, transcript: 'x' })
        .longestPauseS,
    ).toBeNull()
  })
})
