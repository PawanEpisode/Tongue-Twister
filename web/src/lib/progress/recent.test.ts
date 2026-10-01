import { describe, expect, it } from 'vitest'
import { RANDOM_EXCLUDE_MAX, RECENT_KEEP, pushRecent } from './recent'

describe('pushRecent', () => {
  it('puts the newest first', () => {
    expect(pushRecent(['b', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  })
  it('moves a repeat to the front instead of duplicating it', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })
  it('keeps only the last RECENT_KEEP', () => {
    let list: string[] = []
    for (let i = 0; i < 12; i++) list = pushRecent(list, `t${i}`)
    expect(list).toHaveLength(RECENT_KEEP)
    expect(list[0]).toBe('t11')
  })
  it('never exceeds the API exclude cap, whatever cap is asked for', () => {
    let list: string[] = []
    for (let i = 0; i < 40; i++) list = pushRecent(list, `t${i}`, 99)
    expect(list).toHaveLength(RANDOM_EXCLUDE_MAX)
  })
})
