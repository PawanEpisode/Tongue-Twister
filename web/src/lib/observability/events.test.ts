import { describe, expect, it } from 'vitest'
import { sanitise, scoreBand } from './events'

describe('event allow-list', () => {
  it('drops undeclared events', () => {
    expect(sanitise('page_viewed', {})).toBeNull()
    expect(sanitise('toString', {})).toBeNull()
  })
  it('keeps only declared props with allowed values', () => {
    expect(
      sanitise('attempt_completed', {
        kind: 'test',
        score_band: '80-100',
        transcript: 'peter piper',
        email: 'a@b.co',
      }),
    ).toEqual({ kind: 'test', score_band: '80-100' })
    expect(sanitise('attempt_completed', { kind: 'free text' })).toEqual({})
    expect(sanitise('twister_generated', { difficulty: 3 })).toEqual({
      difficulty: 3,
    })
    expect(
      sanitise('twister_generated', { difficulty: 9, topic: 'cats' }),
    ).toEqual({})
    expect(sanitise('score_card_shared', { url: 'https://x/s/abc' })).toEqual(
      {},
    )
  })
  it('bands scores', () => {
    expect([0, 49, 50, 79, 80, 100].map(scoreBand)).toEqual([
      '0-49',
      '0-49',
      '50-79',
      '50-79',
      '80-100',
      '80-100',
    ])
  })
})
