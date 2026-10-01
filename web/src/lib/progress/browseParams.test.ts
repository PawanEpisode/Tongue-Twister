import { describe, expect, it } from 'vitest'
import { parseSort, parseStatus, toApiParams } from './browseParams'

describe('parseStatus', () => {
  it('accepts the known values', () => {
    expect(parseStatus('mastered')).toBe('mastered')
    expect(parseStatus('in_progress')).toBe('in_progress')
    expect(parseStatus('favorites')).toBe('favorites')
  })
  it.each([undefined, null, '', 'nope', 42, 'Mastered'])(
    'drops %s silently',
    (v) => {
      expect(parseStatus(v)).toBeUndefined()
    },
  )
})

describe('parseSort', () => {
  it('accepts known sorts', () => {
    expect(parseSort('best_desc')).toBe('best_desc')
    expect(parseSort('hardest')).toBe('hardest')
  })
  it('keeps the default out of the URL', () => {
    expect(parseSort('recommended')).toBeUndefined()
  })
  it('drops garbage', () => {
    expect(parseSort('best')).toBeUndefined()
    expect(parseSort(3)).toBeUndefined()
  })
})

describe('toApiParams', () => {
  it('passes status and sort for signed-in users', () => {
    expect(toApiParams({ status: 'mastered', sort: 'newest' }, true)).toEqual({
      status: 'mastered',
      sort: 'newest',
    })
  })
  it('ignores status for guests but keeps sort', () => {
    expect(toApiParams({ status: 'mastered', sort: 'newest' }, false)).toEqual({
      sort: 'newest',
    })
  })
  it('omits the default sort and empty input', () => {
    expect(toApiParams({ sort: 'recommended' }, true)).toEqual({})
    expect(toApiParams({}, true)).toEqual({})
  })
})
