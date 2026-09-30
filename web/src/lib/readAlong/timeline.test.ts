import { describe, expect, it } from 'vitest'
import { countSyllables, splitLines, tokenize, wordIndexAtChar } from './text'
import {
  buildTimeline,
  clampWpm,
  defaultWpm,
  effectiveLoops,
  fractionAt,
  indexAt,
  remapElapsed,
} from './timeline'

const words = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => ['fuzzy', 'wuzzy', 'was', 'a', 'bear'][i % 5],
  ).join(' ')

describe('text', () => {
  it('tokenises on whitespace and keeps punctuation attached', () => {
    expect(tokenize('  Peter,  Piper\npicked. ')).toEqual([
      'Peter,',
      'Piper',
      'picked.',
    ])
  })

  it('counts syllables with a silent-e rule and a floor of 1', () => {
    expect(countSyllables('peppers')).toBe(2)
    expect(countSyllables('made')).toBe(1)
    expect(countSyllables('table')).toBe(2)
    expect(countSyllables('a')).toBe(1)
    expect(countSyllables('—')).toBe(0)
  })

  it('splits lines at sentence ends and at the max width', () => {
    const tokens = tokenize('One two. Three four five six seven eight')
    expect(splitLines(tokens, 4)).toEqual([
      [0, 1],
      [2, 3, 4, 5],
      [6, 7],
    ])
  })
})

describe('buildTimeline', () => {
  it('takes exactly 60000/wpm per word on average (60 words @ 120 WPM = 30 s)', () => {
    const tl = buildTimeline(words(60), 120, { punctuationPauses: false })
    expect(tl.totalMs).toBeCloseTo(30_000, 3)
  })

  it('is monotonic and gives long words more time', () => {
    const tl = buildTimeline('a extraordinarily a', 100, {
      punctuationPauses: false,
    })
    expect(tl.starts).toEqual([...tl.starts].sort((x, y) => x - y))
    expect(tl.durations[1]).toBeGreaterThan(tl.durations[0])
  })

  it('adds punctuation pauses only when enabled, and not after the final word', () => {
    const text = 'One, two. three'
    const plain = buildTimeline(text, 100, { punctuationPauses: false })
    const paused = buildTimeline(text, 100, { punctuationPauses: true })
    expect(paused.starts[1]).toBeGreaterThan(plain.starts[1])
    expect(paused.starts[2] - plain.starts[2]).toBeGreaterThan(
      paused.starts[1] - plain.starts[1],
    )
    expect(buildTimeline('Stop.', 100).totalMs).toBe(
      buildTimeline('Stop', 100).totalMs,
    )
  })

  it('gives punctuation-only tokens a lighter weight', () => {
    const tl = buildTimeline('go — now', 100, { punctuationPauses: false })
    expect(tl.durations[1]).toBeLessThan(tl.durations[0])
  })

  it('handles empty text and clamps speed', () => {
    expect(buildTimeline('   ', 100)).toMatchObject({ tokens: [], totalMs: 0 })
    expect(buildTimeline('hi', 9999).wpm).toBe(300)
    expect(clampWpm(1)).toBe(40)
  })
})

describe('indexAt / fractionAt', () => {
  const tl = buildTimeline(words(10), 110)
  it('finds the current word by binary search and clamps', () => {
    expect(indexAt(tl, -50)).toBe(0)
    expect(indexAt(tl, 0)).toBe(0)
    expect(indexAt(tl, tl.starts[4])).toBe(4)
    expect(indexAt(tl, tl.starts[4] - 0.001)).toBe(3)
    expect(indexAt(tl, tl.totalMs * 10)).toBe(9)
  })
  it('reports progress inside a word', () => {
    const mid = tl.starts[3] + tl.durations[3] / 2
    expect(fractionAt(tl, mid)).toBeCloseTo(0.5, 5)
  })
})

describe('remapElapsed', () => {
  it('keeps the current word (and progress within it) when speed changes mid-run', () => {
    const slow = buildTimeline(words(30), 100)
    const fast = buildTimeline(words(30), 140)
    const at = slow.starts[12] + slow.durations[12] * 0.25
    const next = remapElapsed(slow, fast, at)
    expect(indexAt(fast, next)).toBe(12)
    expect(fractionAt(fast, next)).toBeCloseTo(0.25, 5)
    expect(next).toBeLessThan(at)
  })
})

describe('effectiveLoops', () => {
  it('defaults very short twisters to three loops unless the user chose otherwise', () => {
    expect(effectiveLoops(4, 1)).toBe(3)
    expect(effectiveLoops(4, 5)).toBe(5)
    expect(effectiveLoops(5, 1)).toBe(1)
    expect(effectiveLoops(3, 0)).toBe(0)
  })
})

describe('wordIndexAtChar', () => {
  const text = 'Fuzzy Wuzzy  was a bear'
  it('maps character offsets (as reported by speech boundaries) to word indexes', () => {
    expect(
      [0, 3, 6, 12, 13, 17, 19].map((c) => wordIndexAtChar(text, c)),
    ).toEqual([0, 0, 1, 1, 2, 3, 4])
    expect(wordIndexAtChar(text, 999)).toBe(4)
    expect(wordIndexAtChar('', 0)).toBe(0)
  })
})

describe('defaultWpm', () => {
  it('scales with difficulty and falls back safely', () => {
    expect([1, 2, 3, 4].map(defaultWpm)).toEqual([90, 110, 130, 150])
    expect(defaultWpm(99)).toBe(110)
  })
})
