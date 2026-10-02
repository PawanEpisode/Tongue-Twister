/**
 * Turns a device assessment into the fields POST /attempts/ accepts for `engine: "ondevice"` (the server
 * re-validates every word against the twister and recomputes the score, so this is a claim, not a trust).
 */
import { FRAME_MS } from '../types'
import type { Assessment, PhonemeResult, WordResult } from '../types'

export type DeviceWordBody = {
  i: number
  target: string
  status: 'correct' | 'near' | 'wrong' | 'missed'
  reason?: string
  start_ms?: number
  end_ms?: number
  phonemes: DevicePhonemeBody[]
}
export type DevicePhonemeBody = {
  t: string
  verdict: string
  heard?: string
  delta?: number
  lpp?: number
  lpr?: number
  start_ms?: number
  end_ms?: number
}

export type DeviceFields = {
  engine: 'ondevice'
  engine_version: string
  model_version: string
  scoring_profile: string
  nonce: string
  audio_sha256: string
  quality: Record<string, number | boolean>
  words: DeviceWordBody[]
}

/** Bump when the TS engine changes behaviour; shown to us in the attempt row for debugging drift. */
export const ENGINE_VERSION = 'web-1'

const finite = (x: number | null | undefined) =>
  typeof x === 'number' && Number.isFinite(x) ? x : undefined
const ms = (frame: number) =>
  Math.max(0, Math.min(600_000, Math.round(frame * FRAME_MS)))
const num = (x: number | null | undefined, places = 3) => {
  const v = finite(x)
  return v === undefined
    ? undefined
    : Math.round(v * 10 ** places) / 10 ** places
}

function phoneme(p: PhonemeResult): DevicePhonemeBody {
  return {
    t: p.target.slice(0, 8),
    verdict: p.verdict,
    ...(p.heard ? { heard: p.heard.slice(0, 8) } : {}),
    ...(num(p.delta) !== undefined ? { delta: num(p.delta) } : {}),
    ...(num(p.lpp) !== undefined ? { lpp: num(p.lpp) } : {}),
    ...(num(p.lpr) !== undefined ? { lpr: num(p.lpr) } : {}),
    start_ms: ms(p.start),
    end_ms: ms(p.end),
  }
}

/** `offset` shifts engine word indexes back to positions in the whole twister (segment practice). */
function word(w: WordResult, offset: number): DeviceWordBody | null {
  // 'extra' is a count, not a word of the twister; the server only accepts statuses for expected words.
  if (w.status === 'extra') return null
  return {
    i: w.index + offset,
    target: w.text.slice(0, 64),
    status: w.status,
    ...(w.reason ? { reason: w.reason } : {}),
    start_ms: ms(w.start),
    end_ms: ms(w.end),
    phonemes: w.phonemes.map(phoneme),
  }
}

/** The words the person actually said, for the free-text `transcript` field (display and search only). */
export const heardTranscript = (a: Assessment) =>
  a.words
    .filter((w) => w.status !== 'missed' && w.status !== 'extra')
    .map((w) => w.text)
    .join(' ')

export function deviceFields(args: {
  assessment: Assessment
  segmentStart?: number
  modelVersion: string
  profileCode: string
  nonce: string
  audioSha256: string
  quality: Record<string, number | boolean>
  engineVersion?: string
}): DeviceFields {
  const offset = args.segmentStart ?? 0
  return {
    engine: 'ondevice',
    engine_version: args.engineVersion ?? ENGINE_VERSION,
    model_version: args.modelVersion,
    scoring_profile: args.profileCode,
    nonce: args.nonce,
    audio_sha256: args.audioSha256,
    quality: args.quality,
    words: args.assessment.words
      .map((w) => word(w, offset))
      .filter((w): w is DeviceWordBody => w !== null),
  }
}
