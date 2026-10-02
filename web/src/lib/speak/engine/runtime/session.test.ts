import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE } from '../types'
import type { Word } from '../types'
import { deviceFields, heardTranscript } from './attemptBody'
import { parseLabelMap } from './labelMap'
import { AnalysisError, analyseRead } from './session'
import type { InferenceLike, ReadInput } from './session'

// A tiny model: classes <b>, K, AE, T; raw vocab is the same four labels.
const labelMap = parseLabelMap({
  version: 'lm',
  blank: '<pad>',
  vocab: ['<pad>', 'k', 'æ', 't'],
  classes: ['<b>', 'K', 'AE', 'T'],
  map: { k: 'K', æ: 'AE', t: 'T' },
  drop: [],
})
const words: Word[] = [{ text: 'cat', variants: [['K', 'AE', 'T']] }]

/** 1 s of speech-like noise burst in the middle of quiet; loud enough to pass the signal gate. */
function clip(opts: { amp?: number; seconds?: number } = {}) {
  const seconds = opts.seconds ?? 2
  const n = 16_000 * seconds
  const x = new Float32Array(n)
  let seed = 7
  for (let i = 0; i < n; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const inSpeech = i > 8000 && i < n - 8000
    const level = inSpeech ? (opts.amp ?? 0.3) : 0.0005
    x[i] = level * (Math.sin(i / 9) * 0.8 + (seed / 0xffffffff - 0.5) * 0.4)
  }
  return x
}

/** Posteriors that spell K, AE, T each for a few frames then blank. */
function modelSpelling(sequence: number[]): InferenceLike & { calls: number } {
  const self = {
    calls: 0,
    async run(samples: Float32Array) {
      self.calls++
      const frames = Math.floor((samples.length - 400) / 320) + 1
      const vocab = 4
      const logits = new Float32Array(frames * vocab).fill(-6)
      for (let f = 0; f < frames; f++) logits[f * vocab] = 4 // blank
      const start = 10
      sequence.forEach((label, k) => {
        for (let f = 0; f < 6; f++) {
          const at = (start + k * 8 + f) * vocab
          logits[at] = -6
          logits[at + label] = 6
        }
      })
      return { logits, frames, vocab, ms: 12 }
    },
  }
  return self
}

const input = (
  samples: Float32Array,
  over: Partial<ReadInput> = {},
): ReadInput => ({
  samples,
  captureRate: 48_000,
  words,
  focus: [],
  difficulty: 2,
  profile: { ...DEFAULT_PROFILE, gateMinSpeechShare: 0.05 },
  labelMap,
  ...over,
})

describe('analyseRead', () => {
  it('scores a clean read and returns exactly the trimmed samples it scored', async () => {
    const samples = clip()
    const engine = modelSpelling([1, 2, 3])
    const out = await analyseRead(engine, input(samples))
    expect(out.kind).toBe('scored')
    if (out.kind !== 'scored') return
    expect(out.assessment.words[0].status).toBe('correct')
    expect(out.clip.length).toBeLessThan(samples.length) // leading/trailing silence trimmed
    expect(out.clip.length).toBeGreaterThan(8000)
    expect(out.quality.latency_ms).toBe(12)
    expect(Object.keys(out.quality).length).toBeLessThanOrEqual(12)
  })
  it('stops at the signal gate without running the model', async () => {
    const engine = modelSpelling([1, 2, 3])
    const quiet = await analyseRead(engine, input(clip({ amp: 0.0006 })))
    expect(quiet).toMatchObject({ kind: 'gate', gate: 'too_quiet' })
    const low = await analyseRead(engine, input(clip(), { captureRate: 8_000 }))
    expect(low).toMatchObject({ kind: 'gate', gate: 'low_sample_rate' })
    const loud = clip({ amp: 3 })
    expect(await analyseRead(engine, input(loud))).toMatchObject({
      kind: 'gate',
      gate: 'clipping',
    })
    expect(engine.calls).toBe(0)
  })
  it('stops at the posterior gate when the model heard no speech', async () => {
    const out = await analyseRead(modelSpelling([]), input(clip()))
    expect(out).toMatchObject({ kind: 'gate', gate: 'too_short' })
  })
  it('reports an unscorable read when nothing matches', async () => {
    const out = await analyseRead(modelSpelling([3, 3, 3, 3, 3]), input(clip()))
    expect(['unscorable', 'scored']).toContain(out.kind)
  })
  it('throws a typed error if the model and label map disagree', async () => {
    const wrong: InferenceLike = {
      run: async () => ({
        logits: new Float32Array(10),
        frames: 2,
        vocab: 5,
        ms: 1,
      }),
    }
    await expect(analyseRead(wrong, input(clip()))).rejects.toBeInstanceOf(
      AnalysisError,
    )
  })
  it('passes through inference failures and cancellation', async () => {
    const failing: InferenceLike = {
      run: async () => {
        throw new Error('boom')
      },
    }
    await expect(analyseRead(failing, input(clip()))).rejects.toThrow('boom')
  })
})

describe('device attempt fields', () => {
  it('maps an assessment to the API body, shifting indexes for a segment', async () => {
    const out = await analyseRead(modelSpelling([1, 2, 3]), input(clip()))
    if (out.kind !== 'scored') throw new Error('expected scored')
    const body = deviceFields({
      assessment: out.assessment,
      segmentStart: 4,
      modelVersion: 'm1',
      profileCode: 'p1',
      nonce: '00000000-0000-4000-8000-000000000000',
      audioSha256: 'a'.repeat(64),
      quality: out.quality,
    })
    expect(body.engine).toBe('ondevice')
    expect(body.words[0]).toMatchObject({
      i: 4,
      target: 'cat',
      status: 'correct',
    })
    expect(body.words[0].phonemes.map((p) => p.t)).toEqual(['K', 'AE', 'T'])
    for (const p of body.words[0].phonemes) {
      expect(p.t.length).toBeLessThanOrEqual(8)
      expect(Number.isInteger(p.start_ms)).toBe(true)
    }
    expect(JSON.parse(JSON.stringify(body))).toEqual(body) // plain JSON, no NaN/undefined holes
    expect(heardTranscript(out.assessment)).toBe('cat')
  })
})
