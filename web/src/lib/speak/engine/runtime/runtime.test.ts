import { describe, expect, it, vi } from 'vitest'
import { PcmBuffer, finishCapture } from './capture'
import {
  CHUNK_SAMPLES,
  OVERLAP_SAMPLES,
  STRIDE,
  framesFor,
  planChunks,
  stitch,
} from './chunking'
import {
  MAX_LATENCY_MS,
  benchClip,
  estimateLatencyMs,
  fastEnough,
  needsDownloadConsent,
  readBench,
  readEnv,
  threadsFor,
  unsupportedReason,
  writeBench,
} from './deviceGate'
import type { Env } from './deviceGate'
import { LabelMapError, collapse, parseLabelMap } from './labelMap'
import { parseManifest } from './manifest'
import { resample } from './resample'
import { OrtRunner, RunnerError, normalise } from './runner'
import type { OrtModuleLike } from './runner'
import { encodeClip, encodeWav, sha256Bytes } from './wav'

const labelMapJson = {
  version: 'lm-1',
  blank: '<pad>',
  vocab: ['<pad>', 'a', 'b', 'ʰ', '|'],
  classes: ['<b>', 'AA', 'B'],
  map: { a: 'AA', b: 'B' },
  drop: ['|', 'ʰ'],
}

describe('label map', () => {
  it('maps raw labels to classes and treats dropped labels and the blank as blank', () => {
    const m = parseLabelMap(labelMapJson)
    expect([...m.toClass]).toEqual([0, 1, 2, 0, 0])
    expect(m.vocabSize).toBe(5)
  })
  it('rejects unmapped labels, duplicate classes and a missing blank', () => {
    expect(() => parseLabelMap({ ...labelMapJson, map: { a: 'AA' } })).toThrow(
      LabelMapError,
    )
    expect(() =>
      parseLabelMap({ ...labelMapJson, classes: ['<b>', 'AA', 'AA'] }),
    ).toThrow(LabelMapError)
    expect(() => parseLabelMap({ ...labelMapJson, vocab: ['a', 'b'] })).toThrow(
      LabelMapError,
    )
    expect(() => parseLabelMap(null)).toThrow(LabelMapError)
    expect(() =>
      parseLabelMap({ ...labelMapJson, map: { a: 'AA', b: 'ZZ' } }),
    ).toThrow(LabelMapError)
  })
  it('collapses to log-probabilities that sum to one', () => {
    const m = parseLabelMap(labelMapJson)
    const logits = new Float32Array([0, 5, 0, 0, 0, /**/ 4, 0, 0, 4, 0])
    const rows = collapse(m, logits, 2)
    for (const row of rows)
      expect(row.reduce((s, x) => s + Math.exp(x), 0)).toBeCloseTo(1, 5)
    expect(rows[0][1]).toBeGreaterThan(rows[0][0]) // 'a' wins in frame 0
    expect(rows[1][0]).toBeGreaterThan(rows[1][1]) // pad + dropped labels all count as blank in frame 1
  })
  it('refuses output of the wrong width', () => {
    const m = parseLabelMap(labelMapJson)
    expect(() => collapse(m, new Float32Array(7), 1)).toThrow(LabelMapError)
  })
})

describe('chunking', () => {
  it('uses one window for short clips and tiles long clips with overlap', () => {
    expect(planChunks(100)).toEqual([{ start: 0, end: 100 }])
    const total = CHUNK_SAMPLES * 2 + 5 * STRIDE
    const plan = planChunks(total)
    expect(plan[0]).toEqual({ start: 0, end: CHUNK_SAMPLES })
    expect(plan.at(-1)!.end).toBe(total)
    for (let i = 1; i < plan.length; i++)
      expect(plan[i - 1].end - plan[i].start).toBe(OVERLAP_SAMPLES)
    expect(plan.every((w) => w.start % STRIDE === 0)).toBe(true)
  })
  it('rejects windows that do not line up with the model stride', () => {
    expect(() => planChunks(1000, 1000, 320)).toThrow(RangeError)
    expect(() => planChunks(1000, 3200, 3200)).toThrow(RangeError)
  })
  it('stitches window outputs into the same frames a single pass would give', () => {
    const vocab = 2
    const total = CHUNK_SAMPLES + 8 * STRIDE
    const frameAt = (f: number) => [f, -f]
    const parts = planChunks(total).map((w) => {
      const frames = framesFor(w.end - w.start)
      const startFrame = w.start / STRIDE
      const logits = new Float32Array(frames * vocab)
      for (let f = 0; f < frames; f++)
        logits.set(frameAt(startFrame + f), f * vocab)
      return { startFrame, frames, logits }
    })
    const { logits, frames } = stitch(parts, vocab)
    expect(frames).toBe(framesFor(total))
    for (let f = 0; f < frames; f++) expect(logits[f * vocab]).toBe(f)
  })
  it('counts model frames like wav2vec2', () => {
    expect(framesFor(399)).toBe(0)
    expect(framesFor(400)).toBe(1)
    expect(framesFor(16_000)).toBe(49)
  })
})

describe('runner', () => {
  const makeOrt = (vocab = 3, frameDelta = 0) => {
    const calls: number[] = []
    const ort: OrtModuleLike = {
      Tensor: class {
        constructor(
          public type: string,
          public data: Float32Array,
          public dims: number[],
        ) {}
      },
      InferenceSession: {
        create: async () => ({
          run: async (feeds: Record<string, unknown>) => {
            const t = feeds.input_values as { data: Float32Array }
            calls.push(t.data.length)
            const frames = framesFor(t.data.length) + frameDelta
            return {
              logits: {
                data: new Float32Array(frames * vocab).fill(0.1),
                dims: [1, frames, vocab],
              },
            }
          },
        }),
      },
    }
    return { ort, calls }
  }
  it('normalises to zero mean and unit variance', () => {
    const out = normalise(
      Float32Array.from({ length: 1000 }, (_, i) => 0.5 + Math.sin(i / 10)),
    )
    const mean = out.reduce((s, x) => s + x, 0) / out.length
    const variance = out.reduce((s, x) => s + (x - mean) ** 2, 0) / out.length
    expect(mean).toBeCloseTo(0, 4)
    expect(variance).toBeCloseTo(1, 3)
  })
  it('runs short clips in one window and long clips in several', async () => {
    const { ort, calls } = makeOrt()
    const runner = await OrtRunner.create(ort, new Uint8Array(1))
    const short = await runner.run(new Float32Array(16_000).fill(0.1))
    expect(short.frames).toBe(framesFor(16_000))
    expect(calls).toHaveLength(1)
    const long = await runner.run(
      new Float32Array(CHUNK_SAMPLES + 4000).fill(0.1),
    )
    expect(long.frames).toBe(framesFor(CHUNK_SAMPLES + 4000))
    expect(calls.length).toBe(3)
  })
  it('rejects too-short input, wrong frame counts and use after dispose', async () => {
    const runner = await OrtRunner.create(makeOrt().ort, new Uint8Array(1))
    await expect(runner.run(new Float32Array(100))).rejects.toMatchObject({
      code: 'empty_input',
    })
    const bad = await OrtRunner.create(makeOrt(3, 1).ort, new Uint8Array(1))
    await expect(bad.run(new Float32Array(16_000))).rejects.toMatchObject({
      code: 'bad_output',
    })
    await runner.dispose()
    await expect(runner.run(new Float32Array(16_000))).rejects.toBeInstanceOf(
      RunnerError,
    )
  })
})

describe('wav', () => {
  it('writes a canonical 16 kHz mono 16-bit header and clamps samples', () => {
    const wav = encodeWav([0, 1, -1, 2, -2, NaN])
    const view = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint32(24, true)).toBe(16_000)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(12)
    expect(wav.length).toBe(44 + 12)
    expect(
      [...Array(6)].map((_, i) => view.getInt16(44 + i * 2, true)),
    ).toEqual([0, 32767, -32767, 32767, -32767, 0])
  })
  it('hashes deterministically (same samples, same bytes, same hash)', async () => {
    const samples = Float32Array.from(
      { length: 800 },
      (_, i) => Math.sin(i / 7) * 0.4,
    )
    const a = await encodeClip(samples)
    const b = await encodeClip(samples.slice())
    expect(a.sha256).toBe(b.sha256)
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(a.sha256).toBe(await sha256Bytes(a.bytes))
    expect(a.durationMs).toBe(50)
  })
})

describe('resample', () => {
  const tone = (hz: number, rate: number, seconds = 0.5) =>
    Float32Array.from({ length: Math.floor(rate * seconds) }, (_, i) =>
      Math.sin((2 * Math.PI * hz * i) / rate),
    )
  const rms = (x: Float32Array, skip = 400) => {
    let s = 0
    for (let i = skip; i < x.length - skip; i++) s += x[i] ** 2
    return Math.sqrt(s / (x.length - 2 * skip))
  }
  it('is the identity at the target rate', () => {
    const x = tone(440, 16_000)
    expect(resample(x, 16_000)).toBe(x)
  })
  it('keeps in-band tones from 48 kHz and 44.1 kHz', () => {
    for (const rate of [48_000, 44_100]) {
      const out = resample(tone(1000, rate), rate)
      expect(out.length).toBe(Math.floor((rate * 0.5) / (rate / 16_000)))
      expect(rms(out)).toBeGreaterThan(0.69)
      expect(rms(out)).toBeLessThan(0.72)
    }
  })
  it('removes content above the new Nyquist instead of aliasing it', () => {
    expect(rms(resample(tone(12_000, 48_000), 48_000))).toBeLessThan(0.02)
  })
  it('can upsample and rejects bad rates', () => {
    expect(resample(tone(500, 8000), 8000).length).toBe(8000)
    expect(() => resample(new Float32Array(10), 0)).toThrow(RangeError)
  })
})

describe('capture buffer', () => {
  it('copies chunks (the worklet reuses its buffers) and joins them in order', () => {
    const buf = new PcmBuffer(100)
    const a = Float32Array.of(1, 2, 3)
    buf.push(a)
    a.fill(9)
    buf.push(Float32Array.of(4, 5))
    expect([...buf.toFloat32()]).toEqual([1, 2, 3, 4, 5])
  })
  it('stops at the cap and says it truncated', () => {
    const buf = new PcmBuffer(5)
    buf.push(Float32Array.of(1, 2, 3, 4))
    buf.push(Float32Array.of(5, 6, 7))
    buf.push(Float32Array.of(8))
    expect(buf.samples).toBe(5)
    expect(buf.truncated).toBe(true)
  })
  it('finishes at 16 kHz and reports the hardware rate for the sample-rate gate', () => {
    const buf = new PcmBuffer(48_000)
    buf.push(new Float32Array(48_000))
    const done = finishCapture(buf, 48_000, 8_000)
    expect(done.samples.length).toBe(16_000)
    expect(done.captureRate).toBe(8_000)
    expect(finishCapture(buf, 48_000, null).captureRate).toBe(48_000)
    expect(finishCapture(buf, 48_000, 96_000).captureRate).toBe(48_000)
  })
})

describe('device gate', () => {
  const good: Env = {
    webAssembly: true,
    simd: true,
    worker: true,
    mediaDevices: true,
    audioWorklet: true,
    cacheStorage: true,
    crypto: true,
    secureContext: true,
    deviceMemory: 8,
    hardwareConcurrency: 8,
    crossOriginIsolated: false,
    connection: null,
  }
  it('accepts a capable browser and names the first missing capability otherwise', () => {
    expect(unsupportedReason(good)).toBeNull()
    expect(unsupportedReason({ ...good, simd: false })).toBe('no_simd')
    expect(unsupportedReason({ ...good, audioWorklet: false })).toBe(
      'no_audio_worklet',
    )
    expect(unsupportedReason({ ...good, secureContext: false })).toBe(
      'insecure_context',
    )
    expect(unsupportedReason({ ...good, deviceMemory: 1 })).toBe('low_memory')
    expect(unsupportedReason({ ...good, deviceMemory: null })).toBeNull() // unknown is not "low"
  })
  it('picks threads only when cross-origin isolated', () => {
    expect(threadsFor(good)).toBe(1)
    expect(threadsFor({ ...good, crossOriginIsolated: true })).toBe(4)
    expect(
      threadsFor({
        ...good,
        crossOriginIsolated: true,
        hardwareConcurrency: 2,
      }),
    ).toBe(1)
  })
  it('asks before a big download on metered links', () => {
    expect(needsDownloadConsent(good)).toBe(false)
    expect(
      needsDownloadConsent({ ...good, connection: { saveData: true } }),
    ).toBe(true)
    expect(
      needsDownloadConsent({ ...good, connection: { type: 'cellular' } }),
    ).toBe(true)
    expect(
      needsDownloadConsent({ ...good, connection: { effectiveType: '4g' } }),
    ).toBe(false)
  })
  it('scales the warm-up to a 15 s read and applies the ceiling', () => {
    expect(estimateLatencyMs(1000)).toBe(3000)
    expect(fastEnough(2000)).toBe(true)
    expect(fastEnough(MAX_LATENCY_MS / 3)).toBe(true)
    expect(fastEnough(MAX_LATENCY_MS / 3 + 10)).toBe(false)
    expect(fastEnough(Number.NaN)).toBe(false)
  })
  it('remembers a benchmark for one model/thread pair, and ignores stale or foreign records', () => {
    const store = new Map<string, string>()
    const kv = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    const now = 1_700_000_000_000
    writeBench(kv, { sha256: 'a', threads: 1, estimateMs: 3000, at: now })
    expect(readBench(kv, 'a', 1, now + 1000)?.estimateMs).toBe(3000)
    expect(readBench(kv, 'b', 1, now + 1000)).toBeNull()
    expect(readBench(kv, 'a', 4, now + 1000)).toBeNull()
    expect(readBench(kv, 'a', 1, now + 30 * 86_400_000)).toBeNull()
    expect(readBench(kv, 'a', 1, now - 3_600_000)).toBeNull() // clock went backwards: distrust
    store.set('twister.accurate.bench.v1', '{not json')
    expect(readBench(kv, 'a', 1, now)).toBeNull()
    expect(readBench(null, 'a', 1)).toBeNull()
  })
  it('survives storage that throws', () => {
    const kv = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => undefined,
    }
    expect(() =>
      writeBench(kv, { sha256: 'a', threads: 1, estimateMs: 1, at: 1 }),
    ).not.toThrow()
    expect(readBench(kv, 'a', 1)).toBeNull()
  })
  it('generates a deterministic synthetic clip', () => {
    const a = benchClip(1)
    expect(a.length).toBe(16_000)
    expect(a).toEqual(benchClip(1))
    expect(Math.max(...a.map(Math.abs))).toBeLessThan(1)
  })
  it('reads capabilities from a (fake) global', () => {
    const env = readEnv({
      navigator: {
        hardwareConcurrency: 6,
        deviceMemory: 4,
        mediaDevices: { getUserMedia: () => {} },
      },
      WebAssembly: { validate: () => true },
      Worker: function () {},
      AudioWorkletNode: function () {},
      AudioContext: function () {},
      caches: {},
      crypto: { subtle: {} },
      isSecureContext: true,
    } as unknown as typeof globalThis)
    expect(unsupportedReason(env)).toBeNull()
    expect(env.hardwareConcurrency).toBe(6)
    expect(unsupportedReason(readEnv({} as unknown as typeof globalThis))).toBe(
      'no_webassembly',
    )
  })
})

describe('manifest', () => {
  const ok = {
    model: {
      name: 'm1',
      sha256: 'a'.repeat(64),
      size_bytes: 1000,
      url: 'https://x.supabase.co/storage/v1/object/public/models/m1/model.onnx',
      label_map_version: 'lm-1',
    },
    scoring_profile: {
      code: 'p1',
      thresholds: { tau_sub: 2.5, gate_min_snr_db: 15, bogus: 1, tau_del: 'x' },
    },
    lexicon_version: 3,
    score_version: 2,
  }
  it('parses a good manifest and layers server thresholds over the defaults', () => {
    const m = parseManifest(ok)!
    expect(m.model.sizeBytes).toBe(1000)
    expect(m.profileCode).toBe('p1')
    expect(m.profile.tauSub).toBe(2.5)
    expect(m.profile.gateMinSnrDb).toBe(15)
    expect(m.profile.tauDel).toBe(3) // malformed value ignored
  })
  it('says "no model" for anything unusable', () => {
    expect(parseManifest({ model: null, scoring_profile: null })).toBeNull()
    expect(parseManifest(null)).toBeNull()
    for (const patch of [
      { sha256: 'zz' },
      { size_bytes: 0 },
      { size_bytes: 10 ** 10 },
      { url: 'http://insecure/model.onnx' },
      { name: '' },
    ])
      expect(
        parseManifest({ ...ok, model: { ...ok.model, ...patch } }),
      ).toBeNull()
    expect(
      parseManifest({ ...ok, scoring_profile: { code: '', thresholds: {} } }),
    ).toBeNull()
  })
})

vi.setConfig({ testTimeout: 15_000 })
