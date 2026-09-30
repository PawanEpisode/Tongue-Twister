import { describe, expect, it } from 'vitest'
import { buildTrainPlan, chunkTwister, MAX_CHUNK_TOKENS } from './chunks'
import { displayWords } from './display'

const texts = (s: string) => chunkTwister(s).map((c) => c.text)

describe('chunkTwister', () => {
  it('returns nothing for text with no scorable words', () => {
    expect(chunkTwister('')).toEqual([])
    expect(chunkTwister('— —')).toEqual([])
  })

  it('keeps a short twister whole', () => {
    expect(texts('Red lorry, yellow lorry')).toEqual([
      'Red lorry, yellow lorry',
    ])
  })

  it('breaks at punctuation, then splits long clauses evenly', () => {
    expect(texts('She sells seashells by the seashore')).toEqual([
      'She sells seashells',
      'by the seashore',
    ])
    expect(
      texts(
        'Peter Piper picked a peck of pickled peppers, a peck of pickled peppers Peter Piper picked',
      ),
    ).toEqual([
      'Peter Piper picked a',
      'peck of pickled peppers,',
      'a peck of pickled',
      'peppers Peter Piper picked',
    ])
  })

  it('folds a clause that is too short into its neighbour', () => {
    expect(texts('Go, go, go! Now stop right here.')).toEqual([
      'Go, go, go!',
      'Now stop right here.',
    ])
    expect(texts('Ha. Peter Piper picked pickled peppers')).toEqual([
      'Ha. Peter Piper',
      'picked pickled peppers',
    ])
  })

  it.each([
    'She sells seashells by the seashore and the shells she sells are surely seashells',
    'Fuzzy Wuzzy was a bear. Fuzzy Wuzzy had no hair; Fuzzy Wuzzy wasn’t very fuzzy, was he?',
    'a b c d e f g h i j k',
    'I ate 21 well-known pies today',
  ])(
    'covers every word exactly once, in order, within the size limit: %s',
    (s) => {
      const chunks = chunkTwister(s)
      const total = displayWords(s).at(-1)!.to
      expect(chunks[0].start).toBe(0)
      expect(chunks.at(-1)!.end).toBe(total)
      chunks.forEach((c, i) => {
        if (i) expect(c.start).toBe(chunks[i - 1].end)
        expect(c.end - c.start).toBeLessThanOrEqual(MAX_CHUNK_TOKENS)
        expect(c.end).toBeGreaterThan(c.start)
      })
    },
  )
})

describe('buildTrainPlan', () => {
  const c = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      start: i * 3,
      end: i * 3 + 3,
      text: `c${i}`,
    }))

  it('is just the chunk for a single chunk', () => {
    expect(buildTrainPlan(c(1)).map((s) => s.kind)).toEqual(['chunk'])
  })
  it('adds the full twister after two chunks', () => {
    expect(buildTrainPlan(c(2)).map((s) => s.kind)).toEqual([
      'chunk',
      'chunk',
      'full',
    ])
  })
  it('stitches neighbouring pairs, then the whole twister', () => {
    const plan = buildTrainPlan(c(5))
    expect(plan.map((s) => s.kind)).toEqual([
      'chunk',
      'chunk',
      'chunk',
      'chunk',
      'chunk',
      'stitch',
      'stitch',
      'full',
    ])
    expect(plan[5]).toMatchObject({ start: 0, end: 6, text: 'c0 c1' })
    expect(plan.at(-1)).toMatchObject({ start: 0, end: 15 })
  })
})
