import { describe, expect, it } from 'vitest'
import { buildClip } from './clip'
import type { Scenario, Speaker } from './clip'
import {
  clock,
  filterTwisters,
  freeTake,
  groupBySlug,
  nextUnrecorded,
  takeCounts,
  takesFor,
} from './coverage'

const speaker: Speaker = {
  id: 'S01',
  accent: 'en-IN',
  age_band: '25-34',
  native: false,
  device_class: 'laptop',
}

const clip = (slug: string, scenario: Scenario, take = 1, who = speaker) =>
  buildClip({
    id: `${who.id}-${slug}-${scenario}${take > 1 ? `-${take}` : ''}`,
    speaker: who,
    scenario,
    swapWord: scenario === 'swap' ? 0 : null,
    slug,
    focus: ['S'],
    difficulty: 1,
    words: [{ text: 'sea', variants: [['S', 'IY']] }],
    posteriors: { vocab: ['S'], logp: [[0]] },
    durationMs: 1000,
  })

describe('coverage', () => {
  const clips = [clip('a', 'clean'), clip('b', 'clean'), clip('a', 'fast')]

  it('counts takes per speaker, twister and scenario', () => {
    expect(takesFor(clips, 'S01', 'a', 'clean')).toBe(1)
    expect(takesFor(clips, 'S02', 'a', 'clean')).toBe(0)
    expect([...takeCounts(clips, 'S01', 'clean').entries()]).toEqual([
      ['a', 1],
      ['b', 1],
    ])
  })

  it('finds the next unrecorded twister, wrapping round, or null when done', () => {
    const slugs = ['a', 'b', 'c', 'd']
    expect(nextUnrecorded(slugs, clips, 'S01', 'clean')).toBe('c')
    expect(nextUnrecorded(slugs, clips, 'S01', 'clean', 'c')).toBe('d')
    expect(nextUnrecorded(slugs, clips, 'S01', 'clean', 'd')).toBe('c')
    expect(nextUnrecorded(['a', 'b'], clips, 'S01', 'clean')).toBeNull()
    expect(nextUnrecorded(slugs, clips, 'S02', 'clean')).toBe('a')
  })

  it('reuses the first free take number so ids never collide after a removal', () => {
    expect(freeTake(clips, 'S01', 'a', 'clean')).toBe(2)
    expect(freeTake([clip('a', 'clean', 2)], 'S01', 'a', 'clean')).toBe(1)
    expect(freeTake([], 'S01', 'a', 'clean')).toBe(1)
  })

  it('groups clips by twister, newest first', () => {
    expect(groupBySlug(clips).map((g) => g.slug)).toEqual(['b', 'a'])
  })
})

describe('filterTwisters', () => {
  const list = [
    {
      slug: 'she-sells',
      text: 'she sells sea shells',
      difficulty: 2,
      difficulty_label: 'Medium',
      focus_sounds: ['SH', 'S'],
    },
    {
      slug: 'dust-is-a-must',
      text: 'dust is a must for a crust',
      difficulty: 1,
      difficulty_label: 'Easy',
      focus_sounds: ['ST'],
    },
  ]
  it('matches every term against slug, words and sounds', () => {
    expect(filterTwisters(list, '')).toHaveLength(2)
    expect(filterTwisters(list, 'DUST crust').map((t) => t.slug)).toEqual([
      'dust-is-a-must',
    ])
    expect(filterTwisters(list, 'sh').map((t) => t.slug)).toContain('she-sells')
    expect(filterTwisters(list, 'nope')).toEqual([])
  })
})

describe('clock', () => {
  it('formats m:ss', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(7400)).toBe('0:07')
    expect(clock(65_000)).toBe('1:05')
  })
})
