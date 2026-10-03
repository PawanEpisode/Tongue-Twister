import { describe, expect, it } from 'vitest'
import { ACCOUNT_SECTIONS } from './sections'
import { visibleSections } from './types'

describe('ACCOUNT_SECTIONS', () => {
  it('has the sections the spec asks for, danger zone last', () => {
    expect(ACCOUNT_SECTIONS.map((s) => s.id)).toEqual([
      'profile',
      'appearance',
      'accessibility',
      'practice',
      'read-along',
      'scoring',
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

  it('hides the Reminders card until the reminders flag is on', () => {
    const ids = (flags: Record<string, boolean>) =>
      visibleSections(ACCOUNT_SECTIONS, flags).map((s) => s.id)
    expect(ids({})).not.toContain('reminders')
    expect(ids({ reminders: false })).not.toContain('reminders')
    expect(ids({ reminders: true })).toContain('reminders')
    // Everything else is unaffected, and the order is the registry's.
    expect(ids({ reminders: true })).toEqual(ACCOUNT_SECTIONS.map((s) => s.id))
  })

  it('only gates on flags that exist in the defaults', async () => {
    const { DEFAULT_FLAGS } = await import('#/lib/flags')
    for (const s of ACCOUNT_SECTIONS)
      if (s.flag) expect(DEFAULT_FLAGS).toHaveProperty(s.flag)
  })
})
