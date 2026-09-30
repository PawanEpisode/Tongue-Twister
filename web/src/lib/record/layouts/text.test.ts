import { describe, expect, it } from 'vitest'
import { visibleLines, wrapWords } from './text'

const measure = (s: string) => s.length * 10
const words = [
  'peter',
  'piper',
  'picked',
  'a',
  'peck',
  'of',
  'pickled',
  'peppers',
]

describe('wrapWords', () => {
  it('breaks lines greedily at the max width', () => {
    const lines = wrapWords(words, measure, 190, 10)
    // "peter piper picked" = 50+10+50+10+60 = 180 ≤ 190; adding "a" (+20) exceeds
    expect(lines[0]).toEqual({ from: 0, to: 3 })
    expect(lines.at(-1)?.to).toBe(words.length)
    expect(
      lines.flatMap((l) =>
        Array.from({ length: l.to - l.from }, (_, i) => l.from + i),
      ),
    ).toEqual(words.map((_, i) => i))
  })
  it('puts an over-wide word on its own line instead of looping', () => {
    const lines = wrapWords(['supercalifragilistic', 'a'], measure, 50, 10)
    expect(lines).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 2 },
    ])
  })
  it('handles no words', () => {
    expect(wrapWords([], measure, 100, 10)).toEqual([])
  })
})

describe('visibleLines', () => {
  const lines = [0, 1, 2, 3, 4, 5].map((i) => ({ from: i * 2, to: i * 2 + 2 }))
  it('shows everything when it fits', () => {
    expect(visibleLines(lines, 0, 10)).toHaveLength(6)
  })
  it('keeps the current line in the window, one line of context above', () => {
    const shown = visibleLines(lines, 6, 3) // word 6 is on line 3
    expect(shown).toEqual(lines.slice(2, 5))
  })
  it('does not run past either end', () => {
    expect(visibleLines(lines, 0, 3)).toEqual(lines.slice(0, 3))
    expect(visibleLines(lines, 11, 3)).toEqual(lines.slice(3, 6))
    expect(visibleLines(lines, -1, 3)).toEqual(lines.slice(0, 3))
  })
})
