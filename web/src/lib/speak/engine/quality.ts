/**
 * Quality gates — a port of api/twisters/speak/engine/quality.py (docs/features/13 section 3.7).
 * Pinned by api/tests/fixtures/quality_vectors.json. A failed gate yields no score and no attempt.
 */
import { DEFAULT_PROFILE, FRAME_MS } from './types'
import type { Posteriors, ScoringProfile } from './types'

export type Gate =
  | 'too_short'
  | 'too_quiet'
  | 'too_noisy'
  | 'clipping'
  | 'low_sample_rate'
  | 'background_sound'

export type Quality = {
  ok: boolean
  gate: Gate | null
  loudDbfs: number | null
  snrDb: number | null
  clipShare: number | null
  speechShare: number | null
  entropyShare: number | null
}

const LOUD_SHARE = 0.3
const FLOOR_PERCENTILE = 0.1
const SPEECH_PERCENTILE = 0.9
const CLIP_LEVEL = 0.99
const SILENCE_DBFS = -180
export const TRIM_PAD_MS = 150
const TRIM_BELOW_SPEECH_DB = 30
const REFERENCE_WPM: Record<number, number> = { 1: 110, 2: 130, 3: 150, 4: 170 }

/** What to tell the speaker for each gate (the specific words are product copy, not engine logic). */
export const GATE_MESSAGE: Record<Gate, string> = {
  too_short: 'We only caught part of that — start from the top.',
  too_quiet: 'Too quiet — move a little closer to the mic.',
  too_noisy: 'Too noisy here — try somewhere quieter.',
  clipping: 'Too loud — move back a little.',
  low_sample_rate: 'This microphone is too low quality for Accurate mode.',
  background_sound: 'Lots of background sound — try somewhere quieter.',
}

const fail = (gate: Gate, extra: Partial<Quality> = {}): Quality => ({
  ok: false,
  gate,
  loudDbfs: null,
  snrDb: null,
  clipShare: null,
  speechShare: null,
  entropyShare: null,
  ...extra,
})

const dbfs = (power: number) =>
  power > 0 ? 10 * Math.log10(power) : SILENCE_DBFS

function framePowers(samples: ArrayLike<number>, frame: number): number[] {
  const n = Math.floor(samples.length / frame)
  const out = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = i * frame; j < (i + 1) * frame; j++)
      sum += samples[j] * samples[j]
    out[i] = sum / frame
  }
  return out
}

/** Nearest rank, no interpolation: identical in every port. */
const percentile = (sorted: number[], q: number) =>
  sorted[Math.floor(q * (sorted.length - 1))]

/**
 * `captureRate` is the microphone's own rate before resampling to `sampleRate` (the sample-rate gate asks
 * about the hardware, not about our 16 kHz copy).
 */
export function signalGate(
  samples: ArrayLike<number>,
  sampleRate: number,
  profile: ScoringProfile = DEFAULT_PROFILE,
  captureRate?: number,
): Quality {
  if ((captureRate ?? sampleRate) < profile.gateMinSampleRate)
    return fail('low_sample_rate')
  const frame = Math.floor((sampleRate * FRAME_MS) / 1000)
  const powers = framePowers(samples, frame)
  if (powers.length === 0) return fail('too_short')
  let clipped = 0
  for (let i = 0; i < samples.length; i++)
    if (Math.abs(samples[i]) >= CLIP_LEVEL) clipped++
  const clipShare = clipped / samples.length
  const desc = [...powers].sort((a, b) => b - a)
  const loudCount = Math.max(1, Math.ceil(LOUD_SHARE * desc.length))
  let loudSum = 0
  for (let i = 0; i < loudCount; i++) loudSum += desc[i]
  const loud = dbfs(loudSum / loudCount)
  const db = powers.map(dbfs).sort((a, b) => a - b)
  const snr =
    percentile(db, SPEECH_PERCENTILE) - percentile(db, FLOOR_PERCENTILE)
  const verdict = (gate: Gate | null): Quality => ({
    ok: gate === null,
    gate,
    loudDbfs: loud,
    snrDb: snr,
    clipShare,
    speechShare: null,
    entropyShare: null,
  })
  if (loud < profile.gateMinLoudDbfs) return verdict('too_quiet')
  if (clipShare > profile.gateMaxClipShare) return verdict('clipping')
  if (snr < profile.gateMinSnrDb) return verdict('too_noisy')
  return verdict(null)
}

/** [start, end) of the read plus `padMs` of context; the whole clip when nothing stands out. */
export function speechBounds(
  samples: ArrayLike<number>,
  sampleRate: number,
  padMs = TRIM_PAD_MS,
): [number, number] {
  const frame = Math.floor((sampleRate * FRAME_MS) / 1000)
  const powers = framePowers(samples, frame)
  if (powers.length === 0) return [0, samples.length]
  const db = powers.map(dbfs)
  const threshold =
    percentile(
      [...db].sort((a, b) => a - b),
      SPEECH_PERCENTILE,
    ) - TRIM_BELOW_SPEECH_DB
  let first = -1
  let last = -1
  for (let i = 0; i < db.length; i++)
    if (db[i] >= threshold) {
      if (first < 0) first = i
      last = i
    }
  if (first < 0) return [0, samples.length]
  const pad = Math.floor((sampleRate * padMs) / 1000)
  return [
    Math.max(0, first * frame - pad),
    Math.min(samples.length, (last + 1) * frame + pad),
  ]
}

/** How long the twister takes at the reference pace for its level. */
export const expectedSpeechMs = (wordCount: number, difficulty: number) =>
  (60_000 * wordCount) / (REFERENCE_WPM[difficulty] ?? REFERENCE_WPM[2])

function entropy(row: ArrayLike<number>): number {
  let total = 0
  const probs = new Array<number>(row.length)
  for (let i = 0; i < row.length; i++) {
    probs[i] = Math.exp(row[i])
    total += probs[i]
  }
  if (total <= 0) return 0
  let h = 0
  for (const p of probs) {
    const q = p / total
    if (q > 0) h -= q * Math.log(q)
  }
  return h
}

export function posteriorGate(
  post: Posteriors,
  expectedMs: number,
  profile: ScoringProfile = DEFAULT_PROFILE,
): Quality {
  let first = -1
  let last = -1
  post.logp.forEach((row, t) => {
    let best = 0
    for (let q = 1; q < row.length; q++) if (row[q] > row[best]) best = q
    if (best !== 0) {
      if (first < 0) first = t
      last = t
    }
  })
  if (first < 0) return fail('too_short', { speechShare: 0 })
  const spanMs = (last - first + 1) * FRAME_MS
  const share = expectedMs > 0 ? spanMs / expectedMs : 1
  if (share < profile.gateMinSpeechShare)
    return fail('too_short', { speechShare: share })
  const window = post.logp.slice(first, last + 1)
  const confused = window.filter(
    (r) => entropy(r) > profile.gateMaxEntropy,
  ).length
  const entropyShare = confused / window.length
  if (entropyShare > profile.gateEntropyShare)
    return fail('background_sound', { speechShare: share, entropyShare })
  return {
    ok: true,
    gate: null,
    loudDbfs: null,
    snrDb: null,
    clipShare: null,
    speechShare: share,
    entropyShare,
  }
}
