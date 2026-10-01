import { describe, expect, it } from 'vitest'
import {
  DELETE_CONFIRM_WORD,
  deletionState,
  formatDeletionDate,
  isDeleteConfirmed,
} from './deletion'

describe('isDeleteConfirmed', () => {
  it('needs the exact word, case-sensitive', () => {
    expect(isDeleteConfirmed(DELETE_CONFIRM_WORD)).toBe(true)
    expect(isDeleteConfirmed('delete')).toBe(false)
    expect(isDeleteConfirmed('DELET')).toBe(false)
    expect(isDeleteConfirmed('')).toBe(false)
  })

  it('forgives surrounding spaces only', () => {
    expect(isDeleteConfirmed('  DELETE ')).toBe(true)
    expect(isDeleteConfirmed('DELETE ME')).toBe(false)
  })
})

describe('deletionState', () => {
  it('is pending only when a purge date is set', () => {
    expect(
      deletionState({ deletion_scheduled_for: '2026-10-31T00:00:00Z' }),
    ).toEqual({
      pending: true,
      scheduledFor: '2026-10-31T00:00:00Z',
    })
    expect(deletionState({ deletion_scheduled_for: null })).toEqual({
      pending: false,
    })
    expect(deletionState({})).toEqual({ pending: false })
    expect(deletionState(undefined)).toEqual({ pending: false })
  })
})

describe('formatDeletionDate', () => {
  it('writes a long date in the given locale', () => {
    const out = formatDeletionDate('2026-10-31T12:00:00Z', 'en-GB')
    expect(out).toMatch(/31 October 2026/)
  })

  it('returns the input when it is not a date', () => {
    expect(formatDeletionDate('soon')).toBe('soon')
  })
})
