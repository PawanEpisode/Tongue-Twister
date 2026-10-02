import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildClip,
  bundleJson,
  clipId,
  decodeLogp,
  deviceClass,
  encodeLogp,
  fromFloat16,
  toFloat16,
} from './clip'
import type { Speaker } from './clip'
import { planSwap } from './swapPlan'
import { runBenchmark } from './benchmark'

const fixtures = new URL(
  '../../../../tools/calibrate/fixtures/',
  import.meta.url,
)
const vector = JSON.parse(
  readFileSync(new URL('f16_vector.json', fixtures), 'utf8'),
) as {
  values: number[]
  base64: string
  decoded: number[]
}

describe('float16 gold encoding', () => {
  it('writes exactly the bytes the Python tools wrote for the shared vector', () => {
    expect(encodeLogp([vector.values])).toBe(vector.base64)
  })
  it('reads back what Python decodes', () => {
    const back = decodeLogp(vector.base64, 1, vector.values.length)[0]
    back.forEach((v, i) =>
      expect(Object.is(v, vector.decoded[i]) || v === vector.decoded[i]).toBe(
        true,
      ),
    )
  })
  it('rounds to nearest even across the range, like struct "e"', () => {
    // 1 + 2^-11 is exactly halfway between two halves: ties go to the even mantissa
    expect(fromFloat16(toFloat16(1 + 2 ** -11))).toBe(1)
    expect(fromFloat16(toFloat16(1 + 3 * 2 ** -11))).toBe(1 + 2 ** -9)
    expect(fromFloat16(toFloat16(-0.5))).toBe(-0.5)
    expect(fromFloat16(toFloat16(2 ** -24))).toBe(2 ** -24) // smallest subnormal
    expect(toFloat16(2 ** -26)).toBe(0) // underflows
    expect(fromFloat16(toFloat16(65504))).toBe(65504)
    expect(toFloat16(70000)).toBe(0x7c00) // overflows to infinity
  })
  it('clamps log-probabilities into [-60, 0] and refuses a wrong-sized blob', () => {
    expect(decodeLogp(encodeLogp([[-1e9, 5]]), 1, 2)[0]).toEqual([-60, 0])
    expect(() => decodeLogp(encodeLogp([[0, -1]]), 2, 2)).toThrow(RangeError)
  })
})

const speaker: Speaker = {
  id: 'S01',
  accent: 'en-IN',
  age_band: '25-34',
  native: true,
  device_class: 'laptop',
}
const words = [
  { text: 'she', variants: [['SH', 'IY']] },
  { text: 'sells', variants: [['S', 'EH', 'L', 'Z']] },
]
const posteriors = {
  vocab: ['<b>', 'S', 'SH'],
  logp: [
    [-0.1, -3, -3],
    [-3, -0.1, -3],
  ],
}
const base = {
  id: 'S01-sells-swap',
  speaker,
  slug: 'sells',
  focus: ['S', 'SH'],
  difficulty: 2,
  words,
  posteriors,
  durationMs: 40,
}

describe('buildClip', () => {
  it('produces the shape tools/calibrate/gold.py parses', () => {
    const c = buildClip({
      ...base,
      scenario: 'swap',
      swapWord: 1,
      latencyMs: 812.4,
      model: { name: 'm1' },
    })
    expect(c).toMatchObject({
      schema: 1,
      consent: true,
      scenario: 'swap',
      swap_word: 1,
      latency_ms: 812,
    })
    expect(c.posteriors.frames).toBe(2)
    expect(decodeLogp(c.posteriors.logp_f16, 2, 3)[1][1]).toBeCloseTo(-0.1, 3)
    // the committed synthetic clips and ours agree on every required key
    const dir = new URL('synthetic/', fixtures)
    const sample = JSON.parse(
      readFileSync(new URL(readdirSync(dir)[0], dir), 'utf8'),
    ) as Record<string, unknown>
    for (const key of [
      'schema',
      'id',
      'consent',
      'speaker',
      'scenario',
      'twister',
      'posteriors',
      'duration_ms',
    ])
      expect(c).toHaveProperty(key)
    expect(Object.keys(c.speaker).sort()).toEqual(
      Object.keys(sample.speaker as object).sort(),
    )
    expect(Object.keys(c.twister).sort()).toEqual(
      Object.keys(sample.twister as object).sort(),
    )
    expect(Object.keys(c.posteriors).sort()).toEqual(
      Object.keys(sample.posteriors as object).sort(),
    )
  })
  it('keeps labels consistent: only swap clips name a swapped word, and it must exist', () => {
    expect(() =>
      buildClip({ ...base, scenario: 'swap', swapWord: null }),
    ).toThrow(RangeError)
    expect(() => buildClip({ ...base, scenario: 'swap', swapWord: 5 })).toThrow(
      RangeError,
    )
    expect(() =>
      buildClip({ ...base, scenario: 'clean', swapWord: 0 }),
    ).toThrow(RangeError)
    expect(
      buildClip({ ...base, scenario: 'clean', swapWord: null }).swap_word,
    ).toBeNull()
  })
  it('bundles clips and names takes uniquely', () => {
    const c = buildClip({ ...base, scenario: 'clean', swapWord: null })
    expect(JSON.parse(bundleJson([c, c])).clips).toHaveLength(2)
    expect(clipId('S01', 'sells', 'clean', 1)).toBe('S01-sells-clean')
    expect(clipId('S01', 'sells', 'clean', 3)).toBe('S01-sells-clean-3')
  })
})

describe('deviceClass', () => {
  it('guesses the class from the user agent', () => {
    expect(
      deviceClass(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        true,
      ),
    ).toBe('phone')
    expect(
      deviceClass(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari',
        true,
      ),
    ).toBe('phone')
    expect(
      deviceClass('Mozilla/5.0 (Linux; Android 14; SM-X900) Safari', true),
    ).toBe('tablet')
    expect(
      deviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', true),
    ).toBe('tablet')
    expect(
      deviceClass('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', false),
    ).toBe('laptop')
    expect(deviceClass('curl/8', false)).toBe('unknown')
  })
})

describe('planSwap', () => {
  it('targets the first word with a focus sound and a nearest confusable the model knows', () => {
    const plan = planSwap(words, ['S', 'SH'], ['<b>', 'S', 'SH', 'EH'])
    expect(plan).toEqual({ wordIndex: 0, word: 'she', from: 'SH', to: 'S' })
  })
  it('gives up (no plan) when nothing can be swapped', () => {
    expect(planSwap(words, ['Q'], ['<b>', 'S'])).toBeNull()
    expect(planSwap(words, ['S', 'SH'], ['<b>'])).toBeNull()
  })
})

describe('runBenchmark', () => {
  it('reports latency per second of audio and scales it to a 15 s clip', async () => {
    const seen: number[] = []
    const out = await runBenchmark(
      async (samples) => {
        seen.push(samples.length / 16_000)
        return { ms: (samples.length / 16_000) * 200 } // 200 ms of compute per second of audio
      },
      {
        loadMs: 350,
        threads: 1,
        hardwareConcurrency: 8,
        deviceMemoryGB: 8,
        jsHeapMB: null,
        userAgent: 'Macintosh',
        touch: false,
      },
    )
    expect(out.perSecondMs).toBe(200)
    expect(out.estimate15sMs).toBe(3000)
    expect(out.runsMs).toEqual([600, 1600, 3000])
    expect(seen[0]).toBe(1) // warm-up first
    expect(out.deviceClass).toBe('laptop')
  })
})
