import { describe, expect, it } from 'vitest'
import type { Profile } from '#/lib/api'
import { applyPatch, saveStatusText } from './optimistic'

const me: Profile = {
  id: 'u1',
  email: 'a@b.c',
  display_name: 'Ana',
  avatar_emoji: '🙂',
  xp: 1,
  level: 1,
  current_streak: 0,
  best_streak: 0,
  night_owl: false,
}

describe('applyPatch', () => {
  it('returns a new profile with the patch applied', () => {
    const next = applyPatch(me, { night_owl: true })
    expect(next.night_owl).toBe(true)
    expect(next).not.toBe(me)
    expect(me.night_owl).toBe(false)
  })
})

describe('saveStatusText', () => {
  it('says nothing when idle and something useful otherwise', () => {
    expect(saveStatusText('idle')).toBe('')
    expect(saveStatusText('saving')).toMatch(/saving/i)
    expect(saveStatusText('saved')).toMatch(/saved/i)
    expect(saveStatusText('failed')).toMatch(/put back/i)
  })
})
