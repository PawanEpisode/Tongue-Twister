import { describe, expect, it } from 'vitest'
import { PUBLIC_NAME_MAX, validatePublicName } from './publicName'

describe('validatePublicName', () => {
  it('allows blank (anonymous) and trims/collapses spaces', () => {
    expect(validatePublicName('')).toEqual({ ok: true, value: '' })
    expect(validatePublicName('   ')).toEqual({ ok: true, value: '' })
    expect(validatePublicName('  Ana   Maria ')).toEqual({
      ok: true,
      value: 'Ana Maria',
    })
  })
  it('accepts exactly 40 characters and rejects 41, counting code points', () => {
    expect(validatePublicName('a'.repeat(PUBLIC_NAME_MAX)).ok).toBe(true)
    expect(validatePublicName('a'.repeat(PUBLIC_NAME_MAX + 1)).ok).toBe(false)
    expect(validatePublicName('😀'.repeat(PUBLIC_NAME_MAX)).ok).toBe(true)
    expect(validatePublicName('😀'.repeat(PUBLIC_NAME_MAX + 1)).ok).toBe(false)
  })
  it('rejects control characters but not tabs/newlines between words', () => {
    expect(validatePublicName('a\u0000b').ok).toBe(false)
    expect(validatePublicName('a\u007fb').ok).toBe(false)
    expect(validatePublicName('a\tb')).toEqual({ ok: true, value: 'a b' })
  })
})
