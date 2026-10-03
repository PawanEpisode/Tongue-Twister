import { describe, expect, it } from 'vitest'
import type { NailedWord, WeakWord } from './api'
import {
  filterWords,
  groupNailed,
  isDueNow,
  missedCount,
  nailedShare,
  nailedThisWeek,
  sortWeak,
  weaknessTone,
} from './wordsView'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString()
const weak = (word: string, over: Partial<WeakWord> = {}): WeakWord => ({
  word,
  seen: 4,
  miss_rate: 0.5,
  weakness: 0.5,
  next_review_at: null,
  respelling: '',
  drill: null,
  ...over,
})
const nailed = (word: string, ago: number): NailedWord => ({
  word,
  respelling: '',
  mastered_at: day(ago),
  seen: 3,
})

describe('filterWords', () => {
  const words = [
    weak('sees', { respelling: 'seez' }),
    weak('cheese'),
    weak("sam's"),
  ]
  it('keeps everything for an empty query', () => {
    expect(filterWords(words, '  ')).toHaveLength(3)
  })
  it('matches spelling and respelling, ignoring case', () => {
    expect(filterWords(words, 'EES').map((w) => w.word)).toEqual([
      'sees',
      'cheese',
    ])
    expect(filterWords(words, 'seez').map((w) => w.word)).toEqual(['sees'])
  })
})

describe('sortWeak', () => {
  const a = weak('a', {
    weakness: 0.3,
    miss_rate: 1,
    seen: 2,
    next_review_at: day(-3),
  })
  const b = weak('b', {
    weakness: 0.9,
    miss_rate: 0.5,
    seen: 8,
    next_review_at: day(-1),
  })
  const c = weak('c', {
    weakness: 0.6,
    miss_rate: 1,
    seen: 6,
    next_review_at: null,
  })
  it('weakest first', () => {
    expect(sortWeak([a, b, c], 'weakest').map((w) => w.word)).toEqual([
      'b',
      'c',
      'a',
    ])
  })
  it('most missed, then most seen', () => {
    expect(sortWeak([a, b, c], 'missed').map((w) => w.word)).toEqual([
      'c',
      'a',
      'b',
    ])
  })
  it('due soonest, never-scheduled first', () => {
    expect(sortWeak([a, b, c], 'due').map((w) => w.word)).toEqual([
      'c',
      'b',
      'a',
    ])
  })
  it('does not change the input', () => {
    const input = [a, b, c]
    sortWeak(input, 'weakest')
    expect(input.map((w) => w.word)).toEqual(['a', 'b', 'c'])
  })
})

describe('small helpers', () => {
  it('counts misses', () => {
    expect(missedCount({ miss_rate: 0.75, seen: 4 })).toBe(3)
  })
  it('knows what is due', () => {
    expect(isDueNow(null, NOW)).toBe(true)
    expect(isDueNow(day(1), NOW)).toBe(true)
    expect(isDueNow(day(-1), NOW)).toBe(false)
  })
  it('picks a tone', () => {
    expect(weaknessTone(1).tone).toBe('high')
    expect(weaknessTone(0.5).tone).toBe('mid')
    expect(weaknessTone(0.1).tone).toBe('low')
  })
  it('measures progress', () => {
    expect(nailedShare(0, 0)).toBe(0)
    expect(nailedShare(3, 9)).toBeCloseTo(0.25)
  })
})

describe('nailed grouping', () => {
  const items = [
    nailed('a', 0),
    nailed('b', 1),
    nailed('c', 3),
    nailed('d', 12),
    nailed('e', 0),
  ]
  it('groups newest first and drops empty groups', () => {
    const g = groupNailed(items, NOW)
    expect(g.map((x) => [x.key, x.items.map((w) => w.word)])).toEqual([
      ['today', ['a', 'e']],
      ['yesterday', ['b']],
      ['week', ['c']],
      ['earlier', ['d']],
    ])
    expect(groupNailed([nailed('x', 0)], NOW).map((x) => x.key)).toEqual([
      'today',
    ])
  })
  it('counts the week', () => {
    expect(nailedThisWeek(items, NOW)).toBe(4)
  })
})
