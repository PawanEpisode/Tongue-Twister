/** Runs the API's shared quality vectors (api/tests/fixtures/quality_vectors.json) against this port. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  expectedSpeechMs,
  posteriorGate,
  signalGate,
  speechBounds,
} from './quality'
import { DEFAULT_PROFILE, profileFromThresholds } from './types'

const V = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../../../api/tests/fixtures/quality_vectors.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
)

type Spec = {
  sample_rate: number
  seconds: number
  amp: number
  freq: number
  period_s: number
  duty: number
  floor: number
  lead_s?: number
  capture_rate?: number
}

/** Same formula as api/tests/quality_vector_gen.py::render. */
function render(spec: Spec): Float64Array {
  const sr = spec.sample_rate
  const n = Math.floor(spec.seconds * sr)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const shifted = t - (spec.lead_s ?? 0)
    const on =
      shifted >= 0 && shifted % spec.period_s < spec.duty * spec.period_s
        ? 1
        : 0
    const voiced =
      Math.sin(2 * Math.PI * spec.freq * t) +
      0.5 * Math.sin(2 * Math.PI * 2 * spec.freq * t)
    const x =
      (spec.amp * on * voiced) / 1.5 +
      spec.floor * Math.sin(2 * Math.PI * 97 * t)
    out[i] = Math.max(-1, Math.min(1, x))
  }
  return out
}

const near = (got: number | null, want: number | null) => {
  if (want === null) return expect(got).toBeNull()
  expect(got).not.toBeNull()
  expect(Math.abs((got as number) - want)).toBeLessThan(1e-6)
}

describe('signal gate vectors', () => {
  for (const c of V.signals) {
    it(c.name, () => {
      const samples = render(c.spec)
      const got = signalGate(
        samples,
        c.spec.sample_rate,
        DEFAULT_PROFILE,
        c.spec.capture_rate,
      )
      expect(got.gate).toBe(c.expect.gate)
      expect(got.ok).toBe(c.expect.ok)
      near(got.loudDbfs, c.expect.loud_dbfs)
      near(got.snrDb, c.expect.snr_db)
      near(got.clipShare, c.expect.clip_share)
      expect(speechBounds(samples, c.spec.sample_rate)).toEqual(c.bounds)
    })
  }
})

describe('posterior gate vectors', () => {
  for (const c of V.posteriors) {
    it(c.name, () => {
      const profile = profileFromThresholds(c.profile ?? {})
      const got = posteriorGate(
        { vocab: ['<b>', 'A', 'B', 'C', 'D'], logp: c.logp },
        c.expected_ms,
        profile,
      )
      expect(got.gate).toBe(c.expect.gate)
      expect(got.ok).toBe(c.expect.ok)
      near(got.speechShare, c.expect.speech_share)
      near(got.entropyShare, c.expect.entropy_share)
    })
  }
})

describe('profile from server thresholds', () => {
  it('maps snake_case keys, ignores junk and non-finite numbers', () => {
    const p = profileFromThresholds({
      tau_sub: 5,
      pad_frames: 9.7,
      gate_min_snr_db: 8,
      evil: 1,
      tau_del: Number.NaN,
      tau_weak: true,
      name: 'x',
    })
    expect(p.tauSub).toBe(5)
    expect(p.padFrames).toBe(9)
    expect(p.gateMinSnrDb).toBe(8)
    expect(p.tauDel).toBe(DEFAULT_PROFILE.tauDel)
    expect(p.tauWeak).toBe(DEFAULT_PROFILE.tauWeak)
  })
  it('expectedSpeechMs follows the reference pace', () => {
    expect(expectedSpeechMs(13, 2)).toBeCloseTo(6000)
    expect(expectedSpeechMs(13, 99)).toBeCloseTo(6000)
  })
})
