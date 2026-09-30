import { describe, expect, it } from 'vitest'
import { liveHits, scoreLocally } from '../scoring'
import {
  displayStatuses,
  displayWords,
  extraWords,
  problemRows,
  summarise,
} from './display'

describe('displayWords', () => {
  it('maps displayed words onto scoring tokens', () => {
    const d = displayWords('The well-known 21 —  cats')
    expect(d.map((w) => [w.text, w.from, w.to])).toEqual([
      ['The', 0, 1],
      ['well-known', 1, 3],
      ['21', 3, 5], // "twenty one"
      ['—', 5, 5],
      ['cats', 5, 6],
    ])
  })
})

describe('scoreLocally', () => {
  const text = 'She sells seashells by the seashore'
  it('marks each displayed word and reports what was heard', () => {
    const r = scoreLocally({
      text,
      spoken: 'she shells seashells by the',
      durationMs: 4000,
      difficulty: 2,
      focusSounds: ['s', 'sh'],
    })
    expect(r.statuses).toEqual([
      'correct',
      'wrong',
      'correct',
      'correct',
      'correct',
      'missed',
    ])
    expect(
      problemRows(r.rows).map((p) => [p.targetIndex, p.status, p.spoken]),
    ).toEqual([
      [1, 'wrong', 'shells'],
      [5, 'missed', ''],
    ])
    expect(r.evaluation.score.focusGated).toBe(false) // capped only when it would have beaten 79
    expect(summarise(r.rows)).toBe('4 of 6 words correct · 1 wrong · 1 missed')
  })

  it('lists extra words and never penalises below zero', () => {
    const r = scoreLocally({
      text: 'peck',
      spoken: 'um well peck peck peck',
      durationMs: 2000,
      difficulty: 1,
    })
    expect(extraWords(r.rows).length).toBeGreaterThan(0)
    expect(r.score).toBeGreaterThanOrEqual(0)
  })

  it('scores silence as zero without throwing', () => {
    const r = scoreLocally({
      text,
      spoken: '',
      durationMs: 1000,
      difficulty: 2,
    })
    expect(r.score).toBeLessThanOrEqual(10)
    expect(r.statuses.every((s) => s === 'missed')).toBe(true)
  })

  it('treats a twister with no scorable words gracefully', () => {
    const r = scoreLocally({
      text: '— —',
      spoken: 'hello',
      durationMs: 1000,
      difficulty: 2,
    })
    expect(r.accuracy).toBe(0)
    expect(displayStatuses(r.display, r.rows)).toEqual([null, null])
  })
})

describe('liveHits', () => {
  it('lights words as they are said and never blocks on punctuation-only words', () => {
    expect(liveHits('one — two', 'one')).toEqual([true, true, false])
    expect(liveHits('one — two', 'one two')).toEqual([true, true, true])
  })
})
