import { describe, expect, it } from 'vitest'
import { parseSearch, stringifySearch } from './searchParams'

describe('stringifySearch', () => {
  it('writes numeric strings and numbers without quotes', () => {
    expect(stringifySearch({ difficulty: '1' })).toBe('?difficulty=1')
    expect(stringifySearch({ drill: 1, wpm: 110 })).toBe('?drill=1&wpm=110')
  })

  it('leaves ordinary strings alone', () => {
    expect(stringifySearch({ category: 's-sounds', q: 'red lorry' })).toBe(
      '?category=s-sounds&q=red+lorry',
    )
  })

  it('writes nothing for an empty search and skips undefined values', () => {
    expect(stringifySearch({})).toBe('')
    expect(stringifySearch({ difficulty: undefined, origin: 'classic' })).toBe(
      '?origin=classic',
    )
  })

  it('never produces %22 for the values the app generates', () => {
    expect(
      stringifySearch({ difficulty: '3', mode: 'read', wpm: 90, drill: 1 }),
    ).not.toContain('%22')
  })
})

describe('parseSearch', () => {
  it('keeps every plain value as the string it was written as', () => {
    expect(parseSearch('?difficulty=1&q=true&wpm=110&x=null')).toEqual({
      difficulty: '1',
      q: 'true',
      wpm: '110',
      x: 'null',
    })
  })

  it('still opens old links with quoted values', () => {
    expect(parseSearch('?difficulty=%221%22')).toEqual({ difficulty: '1' })
  })
})

describe('round trip', () => {
  it.each([
    { difficulty: '1' },
    { q: '007' },
    { q: 'true' },
    { q: '"quoted"' },
    { q: '"1"' },
    { q: 'a&b=c#d' },
    { q: 'ünïcode ✓' },
    { q: '' },
  ])('survives %j', (search) => {
    const parsed = parseSearch(stringifySearch(search))
    expect(parsed).toEqual(search)
  })
})
