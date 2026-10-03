import { describe, expect, it } from 'vitest'
import { resolveAvatar } from './avatar'
import { validateDisplayName } from './identity'

describe('validateDisplayName', () => {
  it('canonicalises whitespace', () => {
    expect(validateDisplayName('  Ada   Lovelace ')).toEqual({
      ok: true,
      value: 'Ada Lovelace',
    })
  })
  it.each(['', ' ', 'A'])('rejects too short: %j', (v) => {
    expect(validateDisplayName(v).ok).toBe(false)
  })
  it('rejects too long, counting characters not bytes', () => {
    expect(validateDisplayName('é'.repeat(40)).ok).toBe(true)
    expect(validateDisplayName('é'.repeat(41)).ok).toBe(false)
  })
  it.each([
    'a@b.co',
    '<b>hi</b>',
    'visit www.x.com',
    'http://x.y',
    'bad\u0007name',
  ])('rejects unsafe: %j', (v) => expect(validateDisplayName(v).ok).toBe(false))
})

describe('resolveAvatar', () => {
  const name = 'pawan'
  it('uses the photo when chosen and present', () => {
    expect(
      resolveAvatar({ source: 'photo', photoUrl: 'u', emoji: '🦊', name }),
    ).toEqual({ kind: 'photo', url: 'u' })
  })
  it('falls back to the emoji when there is no photo', () => {
    expect(resolveAvatar({ source: 'photo', emoji: '🦊', name })).toEqual({
      kind: 'emoji',
      emoji: '🦊',
    })
  })
  it('uses the emoji when chosen even if a photo exists', () => {
    expect(
      resolveAvatar({ source: 'emoji', photoUrl: 'u', emoji: '🦊', name }),
    ).toEqual({ kind: 'emoji', emoji: '🦊' })
  })
  it('falls back to the initial', () => {
    expect(resolveAvatar({ source: 'emoji', emoji: ' ', name })).toEqual({
      kind: 'initial',
      letter: 'P',
    })
    expect(resolveAvatar({ name: '' })).toEqual({
      kind: 'initial',
      letter: '?',
    })
  })
})
