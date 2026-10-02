import { describe, expect, it } from 'vitest'
import { repeatedPhrase } from './repeats'

describe('repeated phrases', () => {
  it('collapses a phrase pasted on a loop', () => {
    const line = Array.from({ length: 25 }, () => 'Big bold barking dogs').join(
      ' ',
    )
    expect(repeatedPhrase(line)).toEqual({
      phrase: 'Big bold barking dogs',
      times: 25,
    })
  })

  it('ignores case and trailing punctuation', () => {
    expect(repeatedPhrase('Red lorry. Red lorry.')).toEqual({
      phrase: 'Red lorry.',
      times: 2,
    })
  })

  it('leaves a real tongue twister alone', () => {
    expect(repeatedPhrase('She sells seashells by the seashore.')).toBeNull()
  })

  it('picks the shortest tile when a word repeats', () => {
    expect(repeatedPhrase('no no no no')).toEqual({ phrase: 'no', times: 4 })
  })
})
