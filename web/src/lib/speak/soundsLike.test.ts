import { describe, expect, it } from 'vitest'
import { skeleton, soundsLike } from './soundsLike'

describe('soundsLike', () => {
  it('builds a consonant skeleton', () => {
    expect(skeleton('sees')).toBe('ss')
    expect(skeleton('cease')).toBe('ss')
    expect(skeleton('shelves')).toBe('slfs')
    expect(skeleton('showing')).toBe('swnk')
  })

  it.each([
    ['sees', 'cease'],
    ['seats', 'seeds'],
    ['shelves', 'sales'],
    ['showing', 'sowing'],
    ['sees', 'see’s'],
  ])('counts the recogniser’s neighbour of %s: %s', (target, heard) => {
    expect(soundsLike(target, heard)).toBe(true)
  })

  it.each([
    ['sees', 'ice'],
    ['sees', 'cheese'],
    ['seats', 'sees'],
    ['shelves', 'cats'],
    ['showing', 'running'],
    ['sees', ''],
  ])('does not count %s for %s', (target, heard) => {
    expect(soundsLike(target, heard)).toBe(false)
  })
})
