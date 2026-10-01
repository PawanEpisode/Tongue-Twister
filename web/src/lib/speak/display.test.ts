import { describe, expect, it } from 'vitest'
import { liveHits, scoreLocally } from '../scoring'
import {
  displayStatuses,
  displayWords,
  extraWords,
  problemRows,
  rowsFromApi,
  summarise,
  tallyRows,
  wordEntries,
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

describe('rowsFromApi', () => {
  it('maps API words so the same views work for saved attempts', () => {
    const rows = rowsFromApi([
      { target_index: 0, spoken: 'she', status: 'correct', reason: '' },
      {
        target_index: 1,
        spoken: 'shells',
        status: 'wrong',
        reason: 'focus_swap',
      },
      { target_index: null, spoken: 'uh', status: 'extra', reason: '' },
    ])
    expect(summarise(rows)).toBe('1 of 2 words correct · 1 wrong · 1 extra')
    expect(problemRows(rows).map((r) => r.reason)).toEqual(['focus_swap'])
  })
})

describe('wordEntries', () => {
  it('gives each printed word its worst verdict and what was heard', () => {
    const text = 'Red well-known lorry'
    const { rows } = scoreLocally({
      text,
      spoken: 'red well known lorry',
      durationMs: 3000,
      difficulty: 2,
    })
    const entries = wordEntries(displayWords(text), rows)
    expect(entries.map((e) => [e.text, e.status])).toEqual([
      ['Red', 'correct'],
      ['well-known', 'correct'],
      ['lorry', 'correct'],
    ])
  })
  it('marks unspoken words missed and keeps heard words that were wrong', () => {
    const text = 'peter piper picked'
    const { rows } = scoreLocally({
      text,
      spoken: 'peter piper',
      durationMs: 3000,
      difficulty: 2,
    })
    const [, , last] = wordEntries(displayWords(text), rows)
    expect(last).toMatchObject({ status: 'missed', heard: '' })
  })
})

describe('tallyRows', () => {
  it('counts target outcomes and extras apart', () => {
    const { rows } = scoreLocally({
      text: 'red lorry',
      spoken: 'red um lorry yellow',
      durationMs: 3000,
      difficulty: 2,
    })
    expect(tallyRows(rows).correct).toBe(2)
  })
})
