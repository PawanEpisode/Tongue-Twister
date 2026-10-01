import { describe, expect, it } from 'vitest'
import { headlineFor, soundDiff, topFix, wordNotes } from './coaching'
import { tallyStatuses } from './display'
import type { WordEntry } from './display'

const entry = (
  text: string,
  status: WordEntry['status'],
  heard = '',
): WordEntry => ({ text, status, heard, reason: '', targetIndex: 0 })

describe('headlineFor', () => {
  it('names the take by score and by where the words stopped', () => {
    const t = tallyStatuses([
      ...Array(30).fill('correct'),
      ...Array(48).fill('missed'),
    ])
    expect(headlineFor(29, t)).toEqual({
      title: 'Tangled, but you’re close',
      story: 'You nailed the first half. Then the words stopped coming.',
    })
  })
  it('is plain when nothing landed', () => {
    expect(headlineFor(0, tallyStatuses(['missed'])).title).toBe(
      'Tangled — try again',
    )
  })
  it('celebrates a clean take', () => {
    expect(headlineFor(100, tallyStatuses(['correct', 'correct']))).toEqual({
      title: 'Tongue Titan!',
      story: 'Every word landed.',
    })
  })
})

describe('wordNotes', () => {
  it('says why each word was marked', () => {
    const notes = wordNotes([
      entry('Seven', 'correct'),
      entry('slip', 'wrong', 'sleep'),
      entry('sleepy', 'near', 'sleep'),
      entry('Such', 'missed'),
      entry('cats', 'missed'),
    ])
    expect(notes[0]).toBe('landed well.')
    expect(notes[1]).toContain('sounded like “sleep”')
    expect(notes[2]).toBe('was close. One more try.')
    expect(notes[3]).toContain('Keep going to the end')
  })
  it('tells a skipped word apart from a stopped-early one', () => {
    const notes = wordNotes([
      entry('a', 'missed'),
      entry('b', 'correct'),
      entry('c', 'missed'),
    ])
    expect(notes[0]).toContain('Say every word')
    expect(notes[2]).toContain('Keep going to the end')
  })
})

describe('soundDiff', () => {
  it('isolates the sound that changed', () => {
    expect(soundDiff('slip', 'sleep')).toEqual(['i', 'ee'])
  })
  it('gives up on unrelated words', () => {
    expect(soundDiff('cats', 'science')).toBeNull()
    expect(soundDiff('sleepy', 'sleep')).toBeNull()
  })
})

describe('topFix', () => {
  it('picks the most common sound slip and counts it', () => {
    const fix = topFix([
      entry('slip', 'wrong', 'sleep'),
      entry('slip', 'wrong', 'sleep'),
      entry('seats', 'wrong', 'seeds'),
    ])
    expect(fix).toEqual({
      heard: 'sleep',
      target: 'slip',
      tip: 'Short “i”, relaxed lips. Two words slid into “ee”.',
    })
  })
  it('is null when nothing was heard wrong', () => {
    expect(topFix([entry('a', 'correct'), entry('b', 'missed')])).toBeNull()
  })
})
