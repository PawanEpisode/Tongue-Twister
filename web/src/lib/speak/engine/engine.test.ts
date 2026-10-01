/** Runs the API's shared engine vectors (api/tests/fixtures/engine_vectors.json) against this port. */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { assess, scoreStatuses } from './assess'
import { NEG_INF, ctcLogProb, forcedAlign, logaddexp } from './ctc'
import { editAlign, extraRuns, greedyDecode, wordWindows } from './decode'
import { confusables } from './phones'
import type { Posteriors, Word } from './types'
import { DEFAULT_PROFILE } from './types'
import {
  UnpronounceableWords,
  dictPronouncer,
  expandVariants,
  expectedWords,
} from './variants'
import type { AccentRule } from './variants'
import { fuse, phonemeVerdict } from './verdict'

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url))

type AssessExpect = {
  unscorable: string | null
  extras: number
  accuracy: number
  speed: number
  fluency: number
  score: number
  focus_gated: boolean
  long_pause_ms: number
  duration_ms: number
  words: {
    index: number
    text: string
    status: string
    reason: string
    uncertain: boolean
    variant: number
    start: number
    end: number
    phonemes: {
      t: string
      heard: string
      verdict: string
      start: number
      end: number
      delta: number | null
      lpp: number
      lpr: number
      focus: boolean
    }[]
  }[]
}
type Vectors = {
  ctc: {
    name: string
    vocab: string[]
    logp: number[][]
    labels: string[]
    log_prob: number | null
    spans: [number, number][] | null
  }[]
  decode: {
    expected: string[]
    heard: string[]
    rows: [number | null, number | null][]
    extra_runs: number
  }[]
  windows: {
    vocab: string[]
    logp: number[][]
    segments: [number, number, number][]
    windows: ([number, number] | null)[]
  }
  confusables: {
    vocab: string[]
    cases: { phone: string; focus: string[]; out: string[] }[]
  }
  variants: {
    rules: { src: string; dst: string; protects: string[] }[]
    expand: { variants: string[][]; focus: string[]; out: string[][] }[]
    table: Record<string, string[][]>
    expected_words: {
      text: string
      words: Word[] | null
      missing: string[] | null
    }[]
  }
  assess: {
    name: string
    words: Word[]
    focus: string[]
    text_matches: (boolean | null)[] | null
    difficulty: number
    vocab: string[]
    logp: number[][]
    expect: AssessExpect
  }[]
}
const V = JSON.parse(
  readFileSync(
    root('../../../../../api/tests/fixtures/engine_vectors.json'),
    'utf8',
  ),
) as Vectors

const ids = (vocab: readonly string[], labels: readonly string[]) =>
  labels.map((l) => vocab.indexOf(l))

describe('ctc vectors', () => {
  it.each(V.ctc)('$name', (c) => {
    const labels = ids(c.vocab, c.labels)
    const lp = ctcLogProb(c.logp, labels)
    expect(lp === NEG_INF ? null : Math.round(lp * 1e4) / 1e4).toBeCloseTo(
      c.log_prob ?? 0,
      3,
    )
    if (c.log_prob === null) expect(lp).toBe(NEG_INF)
    expect(forcedAlign(c.logp, labels)).toEqual(c.spans)
  })

  it('matches a brute-force sum over every path', () => {
    const rows = [
      [0.6, 0.3, 0.1],
      [0.2, 0.5, 0.3],
      [0.4, 0.1, 0.5],
      [0.3, 0.3, 0.4],
    ].map((r) => r.map(Math.log))
    const brute = (labels: number[]) => {
      let total = 0
      const walk = (t: number, path: number[], acc: number) => {
        if (t === rows.length) {
          const out: number[] = []
          let last = -1
          for (const q of path) {
            if (q !== last && q !== 0) out.push(q)
            last = q
          }
          if (out.join() === labels.join()) total += Math.exp(acc)
          return
        }
        for (let q = 0; q < 3; q++) walk(t + 1, [...path, q], acc + rows[t][q])
      }
      walk(0, [], 0)
      return Math.log(total)
    }
    for (const labels of [[1], [1, 2], [1, 1], [2, 1, 2]])
      expect(ctcLogProb(rows, labels)).toBeCloseTo(brute(labels), 9)
  })

  it('handles infinities and empty input', () => {
    expect(logaddexp(NEG_INF, -2)).toBe(-2)
    expect(logaddexp(NEG_INF, NEG_INF)).toBe(NEG_INF)
    expect(logaddexp(Math.log(0.25), Math.log(0.25))).toBeCloseTo(Math.log(0.5))
    expect(ctcLogProb([], [])).toBe(0)
    expect(ctcLogProb([], [1])).toBe(NEG_INF)
    expect(forcedAlign([[0, 0]], [1, 1, 1])).toBeNull()
  })
})

describe('decode vectors', () => {
  it.each(V.decode)('edit align $expected > $heard', (c) => {
    const rows = editAlign(c.expected, c.heard)
    expect(rows).toEqual(c.rows)
    expect(extraRuns(rows, 3)).toBe(c.extra_runs)
  })

  it('greedy decode collapses repeats but not across blanks', () => {
    const lp = [
      [0.1, 0.9],
      [0.1, 0.9],
      [0.9, 0.1],
      [0.1, 0.9],
    ].map((r) => r.map(Math.log))
    expect(greedyDecode(lp)).toEqual([
      [1, 0, 2],
      [1, 3, 4],
    ])
  })

  it('windows vector', () => {
    const w = V.windows
    const segs = greedyDecode(w.logp)
    expect(segs).toEqual(w.segments)
    const flat = ['S', 'EH', 'L', 'Z', 'SH', 'EH', 'L', 'Z']
    const rows = editAlign(
      flat,
      segs.map(([l]) => w.vocab[l]),
    )
    expect(
      wordWindows(rows, [0, 0, 0, 0, 1, 1, 1, 1], segs, 2, w.logp.length, 7),
    ).toEqual(w.windows)
  })
})

describe('phones and variants vectors', () => {
  it.each(V.confusables.cases)('confusables $phone', (c) => {
    expect(confusables(c.phone, new Set(c.focus), V.confusables.vocab)).toEqual(
      c.out,
    )
  })

  const rules: AccentRule[] = V.variants.rules
  it.each(V.variants.expand)('expand $variants focus $focus', (c) => {
    expect(expandVariants(c.variants, rules, new Set(c.focus))).toEqual(c.out)
  })

  it.each(V.variants.expected_words)('expected words: "$text"', (c) => {
    const lex = dictPronouncer(V.variants.table)
    if (c.missing) {
      try {
        expectedWords(c.text, lex, { rules })
        expect.unreachable()
      } catch (e) {
        expect(e).toBeInstanceOf(UnpronounceableWords)
        expect((e as UnpronounceableWords).words).toEqual(c.missing)
      }
    } else expect(expectedWords(c.text, lex, { rules })).toEqual(c.words)
  })

  it('caps and de-duplicates variants', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      src: 'A',
      dst: String(i),
    }))
    expect(expandVariants([['A']], many, new Set())).toHaveLength(8)
    expect(
      expandVariants(
        [['A', 'B']],
        [
          { src: 'A', dst: 'B' },
          { src: 'B', dst: 'A' },
        ],
        new Set(),
      ),
    ).toEqual([
      ['A', 'B'],
      ['B', 'B'],
      ['A', 'A'],
    ])
  })

  it('does not trip over Object.prototype names', () => {
    expect(dictPronouncer({}).variants('constructor')).toBeNull()
  })
})

describe('verdict logic', () => {
  const p = DEFAULT_PROFILE
  it('bands', () => {
    expect(phonemeVerdict(p, -0.1, null, null)).toEqual(['ok', false])
    expect(phonemeVerdict(p, -2, null, null)).toEqual(['weak', false])
    expect(phonemeVerdict(p, -0.1, -1.5, 2)).toEqual(['uncertain', false])
    expect(phonemeVerdict(p, -0.1, -3, null)).toEqual(['substituted', false])
    expect(phonemeVerdict(p, -0.1, null, -3)).toEqual(['deleted', true])
    expect(phonemeVerdict(p, -0.1, -5, -5)).toEqual(['substituted', false])
    expect(phonemeVerdict(p, -0.1, -5, -6)).toEqual(['deleted', true])
  })
  it('fusion never forgives an acoustic error', () => {
    expect(fuse('wrong', 'focus_swap', false, true)).toEqual([
      'wrong',
      'focus_swap',
    ])
    expect(fuse('correct', '', true, true)).toEqual(['correct', ''])
    expect(fuse('correct', '', true, false)).toEqual(['near', 'uncertain'])
    expect(fuse('correct', '', false, false)).toEqual(['correct', ''])
    expect(fuse('missed', '', false, true)).toEqual(['missed', ''])
    expect(fuse('correct', '', true, null)).toEqual(['correct', ''])
  })
  it('score caps a focus swap at 79', () => {
    const s = scoreStatuses(
      ['correct', 'correct', 'correct', 'wrong'],
      ['', '', '', 'focus_swap'],
      {
        targetWords: 4,
        spokenWords: 4,
        durationMs: 1500,
        longPauseMs: 0,
        difficulty: 1,
      },
    )
    expect(s.score).toBeLessThanOrEqual(79)
  })
})

describe('assess vectors', () => {
  it.each(V.assess)('$name', (c) => {
    const post: Posteriors = { vocab: c.vocab, logp: c.logp }
    const got = assess(post, c.words, c.focus, {
      textMatches: c.text_matches,
      difficulty: c.difficulty,
    })
    const e = c.expect
    expect(got.unscorable).toBe(e.unscorable)
    expect(got.score).toBe(e.score)
    expect(got.focusGated).toBe(e.focus_gated)
    expect(got.extras).toBe(e.extras)
    expect(got.longPauseMs).toBe(e.long_pause_ms)
    expect(got.durationMs).toBe(e.duration_ms)
    expect(got.accuracy).toBeCloseTo(e.accuracy, 3)
    expect(got.speed).toBeCloseTo(e.speed, 3)
    expect(got.fluency).toBeCloseTo(e.fluency, 3)
    expect(got.words.map((w) => w.status)).toEqual(e.words.map((w) => w.status))
    for (const [i, w] of got.words.entries()) {
      const x = e.words[i]
      expect([w.reason, w.uncertain, w.variant, w.start, w.end]).toEqual([
        x.reason,
        x.uncertain,
        x.variant,
        x.start,
        x.end,
      ])
      expect(
        w.phonemes.map((q) => [
          q.target,
          q.heard,
          q.verdict,
          q.start,
          q.end,
          q.focus,
        ]),
      ).toEqual(
        x.phonemes.map((q) => [
          q.t,
          q.heard,
          q.verdict,
          q.start,
          q.end,
          q.focus,
        ]),
      )
      for (const [k, q] of w.phonemes.entries()) {
        const y = x.phonemes[k]
        expect(q.delta === null).toBe(y.delta === null)
        if (q.delta !== null)
          expect(Math.abs(q.delta - y.delta!)).toBeLessThan(2e-3)
        expect(Math.abs(q.lpp - y.lpp)).toBeLessThan(2e-3)
        expect(Math.abs(q.lpr - y.lpr)).toBeLessThan(2e-3)
      }
    }
  })

  it('refuses a vocabulary that cannot say a word', () => {
    const c = V.assess[0]
    expect(() =>
      assess(
        { vocab: c.vocab, logp: c.logp },
        [{ text: 'x', variants: [['QQ']] }],
        [],
      ),
    ).toThrow(/vocabulary/)
  })
})

describe('isolation', () => {
  it('nothing outside the engine imports it (not wired into Speak mode)', () => {
    const src = root('../../../')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = `${dir}/${name}`
        if (statSync(full).isDirectory()) {
          if (!full.includes('/speak/engine')) walk(full)
        } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts')) {
          if (/speak\/engine/.test(readFileSync(full, 'utf8'))) hits.push(full)
        }
      }
    }
    walk(src)
    expect(hits).toEqual([])
  })
})
