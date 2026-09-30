import { describe, expect, it } from 'vitest'
import { daysLeft, daysLeftLabel } from './expiry'

const now = Date.parse('2026-06-01T12:00:00Z')
describe('expiry', () => {
  it('rounds partial days up and never goes negative', () => {
    expect(daysLeft('2026-06-02T11:00:00Z', now)).toBe(1)
    expect(daysLeft('2026-06-04T12:00:00Z', now)).toBe(3)
    expect(daysLeft('2026-05-30T12:00:00Z', now)).toBe(0)
  })
  it('labels', () => {
    expect(daysLeftLabel(0)).toBe('today')
    expect(daysLeftLabel(1)).toBe('tomorrow')
    expect(daysLeftLabel(3)).toBe('in 3 days')
  })
})
