import { describe, expect, it } from 'vitest'
import { hasTrap, trapSpans } from './trap'

const roles = (text: string, sounds: string[]) =>
  trapSpans(text, sounds)
    .filter((span) => span.role !== 'plain' && /[A-Za-z]/.test(span.text))
    .map((span) => [span.text.toLowerCase(), span.role])

describe('trap spans', () => {
  it('marks focus-sound words and gives the repeated word the anchor chip', () => {
    const text = 'Seven sleepy cats slip past sleeping cats and sleek cats.'
    expect(roles(text, ['s', 'sl'])).toEqual([
      ['seven', 'sound'],
      ['sleepy', 'sound'],
      ['cats', 'anchor'],
      ['slip', 'sound'],
      ['sleeping', 'sound'],
      ['cats', 'anchor'],
      ['sleek', 'sound'],
      ['cats', 'anchor'],
    ])
  })

  it('leaves stopwords plain even when they start with a focus sound', () => {
    const text = 'Brisk brown bears bring blue bundles by the bright bay.'
    const marked = roles(text, ['b', 'br', 'bl']).map(([word]) => word)
    expect(marked).toContain('brisk')
    expect(marked).toContain('bears')
    expect(marked).not.toContain('by')
    expect(marked).not.toContain('the')
    expect(hasTrap(text, ['b', 'br', 'bl'])).toBe(true)
  })

  it('marks a word that starts with a focus sound and ignores an empty library', () => {
    expect(
      roles('She sells shells.', ['s', 'sh']).map(([word]) => word),
    ).toEqual(['she', 'sells', 'shells'])
    expect(hasTrap('Unique words only here.', [])).toBe(false)
  })

  it('lets the anchor win when the repeated word is also a sound word', () => {
    expect(roles('Slip slip past the slip.', ['sl'])).toEqual([
      ['slip', 'anchor'],
      ['slip', 'anchor'],
      ['slip', 'anchor'],
    ])
  })
})
