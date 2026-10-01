import { describe, expect, it } from 'vitest'
import { formatDuration, formatPercent, formatScore, plural } from './format'

describe('formatDuration', () => {
  it.each([
    [0, '0 min'],
    [20_000, '<1 min'],
    [90_000, '2 min'],
    [25 * 60_000, '25 min'],
    [60 * 60_000, '1 h'],
    [72 * 60_000, '1 h 12 min'],
  ])('%d ms -> %s', (ms, label) => {
    expect(formatDuration(ms)).toBe(label)
  })
})

describe('formatting helpers', () => {
  it('rounds percentages and scores', () => {
    expect(formatPercent(0.784)).toBe('78%')
    expect(formatScore(71.43)).toBe('71.4')
    expect(formatScore(70)).toBe('70')
    expect(formatScore(null)).toBe('—')
  })
  it('pluralises', () => {
    expect(plural(1, 'day')).toBe('1 day')
    expect(plural(3, 'day')).toBe('3 days')
  })
})
