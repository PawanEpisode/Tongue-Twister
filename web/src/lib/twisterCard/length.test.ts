import { describe, expect, it } from 'vitest'
import { estimatedSeconds, lengthBand, wordCountOf } from './length'

describe('length bands', () => {
  it('keeps a one-liner short, 13 words medium, and 94 words long', () => {
    expect(lengthBand(8)).toBe('short')
    expect(lengthBand(12)).toBe('short')
    expect(lengthBand(13)).toBe('medium')
    expect(lengthBand(40)).toBe('medium')
    expect(lengthBand(41)).toBe('long')
    expect(lengthBand(94)).toBe('long')
  })

  it('matches the card timings at 110 words a minute', () => {
    expect(estimatedSeconds(94)).toBe(51)
    expect(estimatedSeconds(13)).toBe(7)
    expect(estimatedSeconds(100)).toBe(55)
    expect(estimatedSeconds(0)).toBe(0)
  })

  it('uses the stored count and otherwise counts the text', () => {
    expect(wordCountOf({ text: 'one two', word_count: 40 })).toBe(40)
    expect(wordCountOf({ text: '  one   two three  ' })).toBe(3)
  })
})
