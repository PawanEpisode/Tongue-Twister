import { describe, expect, it } from 'vitest'
import { dueLabel } from './dueLabel'

const now = Date.parse('2026-10-01T12:00:00Z')
const at = (hours: number) => new Date(now + hours * 3_600_000).toISOString()

describe('dueLabel', () => {
  it.each([
    [null, 'due now'],
    ['garbage', 'due now'],
    [at(-5), 'due now'],
    [at(0), 'due now'],
    [at(3), 'due tomorrow'],
    [at(24), 'due tomorrow'],
    [at(25), 'due in 2 days'],
    [at(24 * 7), 'due in 7 days'],
  ])('%s -> %s', (when, label) => {
    expect(dueLabel(when, now)).toBe(label)
  })
})
