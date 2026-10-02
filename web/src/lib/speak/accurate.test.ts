import { describe, expect, it } from 'vitest'
import { guessAccent } from './accurate'

describe('guessAccent', () => {
  it('starts from the browser language and never guesses beyond the supported accents', () => {
    expect(guessAccent('en-IN')).toBe('en-IN')
    expect(guessAccent('en-GB')).toBe('en-GB')
    expect(guessAccent('en-AU')).toBe('en-AU')
    expect(guessAccent('en-US')).toBe('en-US')
    expect(guessAccent('hi-IN')).toBe('en-US')
    expect(guessAccent(undefined)).toBe('en-US')
  })
})
