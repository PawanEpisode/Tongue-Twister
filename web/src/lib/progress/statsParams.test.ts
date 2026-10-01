import { describe, expect, it } from 'vitest'
import { parseMode, parseRange } from './statsParams'

describe('stats search params', () => {
  it('falls back to 30 days on anything unknown', () => {
    expect(parseRange('90d')).toBe('90d')
    expect(parseRange('all')).toBe('all')
    expect(parseRange('1y')).toBe('30d')
    expect(parseRange(undefined)).toBe('30d')
  })
  it('drops unknown modes', () => {
    expect(parseMode('record')).toBe('record')
    expect(parseMode('train')).toBeUndefined()
  })
})
