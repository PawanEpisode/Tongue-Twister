/** Runs the API's shared vectors (api/tests/fixtures/speak_vectors.json) and data file against this port. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { align, mergeSplitCompounds } from './align'
import { tokenise } from './normalise'
import { evaluate, unscorableReason } from './score'
import { classify } from './similarity'

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url))
type Vectors = {
  normalise: { in: string; out: string[] }[]
  classify: {
    target: string
    spoken: string
    focus?: string[]
    accepted?: string[]
    status: string
    reason: string
  }[]
  align: {
    target: string
    spoken: string
    focus?: string[]
    rows: [number | null, number | null, string, string][]
  }[]
  unscorable: {
    target: string
    spoken: string
    confidence: number | null
    expect: string | null
  }[]
  score: {
    target: string
    spoken: string
    duration_ms: number
    long_pause_ms: number
    difficulty: number
    focus: string[]
    expect: {
      score: number
      accuracy: number
      speed: number
      fluency: number
      completeness: number
      wpm: number
      focus_gated: boolean
      counts: Record<string, number>
    }
  }[]
}
const V = JSON.parse(
  readFileSync(
    root('../../../../api/tests/fixtures/speak_vectors.json'),
    'utf8',
  ),
) as Vectors

describe('shared vectors', () => {
  it.each(V.normalise)('normalise: $in', (c) => {
    expect(tokenise(c.in)).toEqual(c.out)
  })
  it.each(V.classify)('classify: $target > $spoken', (c) => {
    const m = classify(c.target, c.spoken, c.focus ?? [], c.accepted ?? [])
    expect([m.status, m.reason]).toEqual([c.status, c.reason])
  })
  it.each(V.align)('align: $spoken', (c) => {
    const targets = tokenise(c.target)
    const rows = align(
      targets,
      mergeSplitCompounds(targets, tokenise(c.spoken)),
      {
        focus: c.focus ?? [],
      },
    )
    expect(
      rows.map((r) => [
        r.targetIndex,
        r.spokenIndex,
        r.match.status,
        r.match.reason,
      ]),
    ).toEqual(c.rows)
  })
  it.each(V.score)('score: $spoken', (c) => {
    const { score } = evaluate(c.target, c.spoken, {
      durationMs: c.duration_ms,
      longPauseMs: c.long_pause_ms,
      difficulty: c.difficulty,
      focusSounds: c.focus,
    })
    expect(score.score).toBe(c.expect.score)
    expect(score.counts).toEqual(c.expect.counts)
    expect(score.focusGated).toBe(c.expect.focus_gated)
    for (const k of [
      'accuracy',
      'speed',
      'fluency',
      'completeness',
      'wpm',
    ] as const)
      expect(score[k]).toBeCloseTo(c.expect[k], 3)
  })
})

describe('unscorable vectors', () => {
  it.each(V.unscorable)('$spoken @ $confidence', (c) => {
    const e = evaluate(c.target, c.spoken, { durationMs: 2000 })
    expect(unscorableReason(e, c.confidence)).toBe(c.expect)
  })
})

describe('data parity', () => {
  it('web copy of equivalents.json equals the API file', () => {
    const api = readFileSync(
      root('../../../../api/twisters/speak/data/equivalents.json'),
      'utf8',
    )
    const web = readFileSync(root('./equivalents.json'), 'utf8')
    expect(JSON.parse(web)).toEqual(JSON.parse(api))
  })
})
