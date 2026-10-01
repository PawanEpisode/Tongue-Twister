import { describe, expect, it } from 'vitest'
import { nailedLabel } from './nailedLabel'

const now = Date.parse('2026-10-10T12:00:00Z')
describe('nailedLabel', () => {
  it('reads in days', () => {
    expect(nailedLabel('2026-10-10T08:00:00Z', now)).toBe('today')
    expect(nailedLabel('2026-10-09T08:00:00Z', now)).toBe('yesterday')
    expect(nailedLabel('2026-10-05T08:00:00Z', now)).toBe('5 days ago')
  })
  it('never says a future time', () => {
    expect(nailedLabel('2026-10-11T08:00:00Z', now)).toBe('today')
  })
})
