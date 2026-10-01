import { describe, expect, it } from 'vitest'
import { ACCOUNT_SECTIONS } from './sections'

describe('ACCOUNT_SECTIONS', () => {
  it('has the sections the spec asks for, danger zone last', () => {
    expect(ACCOUNT_SECTIONS.map((s) => s.id)).toEqual([
      'profile',
      'streak',
      'reminders',
      'privacy',
      'data',
      'delete',
    ])
    expect(ACCOUNT_SECTIONS.at(-1)?.tone).toBe('danger')
  })

  it('has unique ids and titles, and a component for each', () => {
    expect(new Set(ACCOUNT_SECTIONS.map((s) => s.id)).size).toBe(
      ACCOUNT_SECTIONS.length,
    )
    expect(new Set(ACCOUNT_SECTIONS.map((s) => s.title)).size).toBe(
      ACCOUNT_SECTIONS.length,
    )
    for (const s of ACCOUNT_SECTIONS)
      expect(typeof s.Component).toBe('function')
  })
})
