import { describe, expect, it } from 'vitest'
import { hasMemberHint } from './hint'

describe('member hint cookie', () => {
  it('is true only for tw_m=1', () => {
    expect(hasMemberHint('a=b; tw_m=1; c=d')).toBe(true)
    expect(hasMemberHint('tw_m=1')).toBe(true)
    expect(hasMemberHint('tw_m=0')).toBe(false)
    expect(hasMemberHint('xtw_m=1')).toBe(false)
    expect(hasMemberHint('')).toBe(false)
    expect(hasMemberHint(undefined)).toBe(false)
  })
})
