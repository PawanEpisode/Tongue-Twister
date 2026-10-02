/**
 * Gold-clip files (tools/calibrate/gold.py is the reader). Everything the offline tools need to re-score a read
 * without the model or the audio: expected words, the frame posteriors as float16, and what the speaker was
 * scripted to do. The float16 encoding is pinned to the Python writer by tools/calibrate/fixtures/f16_vector.json.
 */
import type { AccentLang } from '../api'
import type { Posteriors } from '../speak/engine/types'

export const SCHEMA = 1
export const SCENARIOS = ['clean', 'fast', 'swap', 'slur'] as const
export type Scenario = (typeof SCENARIOS)[number]
export const AGE_BANDS = ['13-17', '18-24', '25-34', '35-49', '50+'] as const
export const DEVICE_CLASSES = [
  'laptop',
  'desktop',
  'phone',
  'tablet',
  'unknown',
] as const

export type Speaker = {
  id: string
  accent: AccentLang
  age_band: (typeof AGE_BANDS)[number]
  native: boolean
  device_class: (typeof DEVICE_CLASSES)[number]
}

export type GoldClip = {
  schema: typeof SCHEMA
  id: string
  consent: true
  speaker: Speaker
  scenario: Scenario
  swap_word: number | null
  twister: {
    slug: string
    focus: string[]
    difficulty: number
    words: { text: string; variants: string[][] }[]
  }
  posteriors: { vocab: string[]; frames: number; logp_f16: string }
  duration_ms: number
  latency_ms?: number
  model?: { name: string; sha256?: string }
  quality?: Record<string, number | boolean>
}

/** IEEE half precision, round to nearest even: bit-identical to Python's struct 'e'. */
export function toFloat16(value: number): number {
  const f32 = new Float32Array(1)
  const u32 = new Uint32Array(f32.buffer)
  f32[0] = value
  const x = u32[0]
  const sign = (x >>> 16) & 0x8000
  const exp = (x >>> 23) & 0xff
  let mant = x & 0x7fffff
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0) // inf / NaN
  const e = exp - 127 + 15
  if (e >= 0x1f) return sign | 0x7c00 // overflow to inf
  if (e <= 0) {
    if (e < -10) return sign // underflow to signed zero
    mant |= 0x800000
    const shift = 14 - e
    let half = mant >>> shift
    const rem = mant & ((1 << shift) - 1)
    const mid = 1 << (shift - 1)
    if (rem > mid || (rem === mid && half & 1)) half++
    return sign | half
  }
  let half = sign | (e << 10) | (mant >>> 13)
  const rem = mant & 0x1fff
  if (rem > 0x1000 || (rem === 0x1000 && half & 1)) half++ // carries into the exponent correctly
  return half
}

export function fromFloat16(h: number): number {
  const sign = h & 0x8000 ? -1 : 1
  const exp = (h >> 10) & 0x1f
  const mant = h & 0x3ff
  if (exp === 0) return sign * mant * 2 ** -24
  if (exp === 0x1f) return mant ? Number.NaN : sign * Infinity
  return sign * (1 + mant / 1024) * 2 ** (exp - 15)
}

const bytesToBase64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Log-probability rows -> base64 little-endian float16 (clamped to [-60, 0], like the Python writer). */
export function encodeLogp(rows: readonly (readonly number[])[]): string {
  const n = rows.reduce((s, r) => s + r.length, 0)
  const bytes = new Uint8Array(n * 2)
  const view = new DataView(bytes.buffer)
  let at = 0
  for (const row of rows)
    for (const v of row) {
      view.setUint16(at, toFloat16(Math.max(-60, Math.min(0, v))), true)
      at += 2
    }
  return bytesToBase64(bytes)
}

export function decodeLogp(
  blob: string,
  frames: number,
  vocab: number,
): number[][] {
  const raw = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0))
  if (raw.length !== frames * vocab * 2)
    throw new RangeError('posteriors have the wrong size')
  const view = new DataView(raw.buffer)
  return Array.from({ length: frames }, (_unused, t) =>
    Array.from({ length: vocab }, (_, v) =>
      fromFloat16(view.getUint16((t * vocab + v) * 2, true)),
    ),
  )
}

export function buildClip(args: {
  id: string
  speaker: Speaker
  scenario: Scenario
  swapWord: number | null
  slug: string
  focus: readonly string[]
  difficulty: number
  words: readonly { text: string; variants: string[][] }[]
  posteriors: Posteriors
  durationMs: number
  latencyMs?: number
  model?: { name: string; sha256?: string }
  quality?: Record<string, number | boolean>
}): GoldClip {
  if (
    args.scenario === 'swap' &&
    (args.swapWord === null ||
      args.swapWord < 0 ||
      args.swapWord >= args.words.length)
  )
    throw new RangeError('a swap clip needs a word to swap')
  if (args.scenario !== 'swap' && args.swapWord !== null)
    throw new RangeError('only swap clips name a swapped word')
  return {
    schema: SCHEMA,
    id: args.id,
    consent: true,
    speaker: args.speaker,
    scenario: args.scenario,
    swap_word: args.swapWord,
    twister: {
      slug: args.slug,
      focus: [...args.focus],
      difficulty: args.difficulty,
      words: args.words.map((w) => ({ text: w.text, variants: w.variants })),
    },
    posteriors: {
      vocab: [...args.posteriors.vocab],
      frames: args.posteriors.logp.length,
      logp_f16: encodeLogp(args.posteriors.logp),
    },
    duration_ms: args.durationMs,
    ...(args.latencyMs !== undefined
      ? { latency_ms: Math.round(args.latencyMs) }
      : {}),
    ...(args.model ? { model: args.model } : {}),
    ...(args.quality ? { quality: args.quality } : {}),
  }
}

export const bundleJson = (clips: readonly GoldClip[]) =>
  JSON.stringify({ clips }, null, 0)

export const clipId = (
  speakerId: string,
  slug: string,
  scenario: Scenario,
  take: number,
) => `${speakerId}-${slug}-${scenario}${take > 1 ? `-${take}` : ''}`

export function deviceClass(
  ua: string,
  touch: boolean,
): Speaker['device_class'] {
  if (/ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua)))
    return 'tablet'
  if (/iphone|android.+mobile|mobile/i.test(ua)) return 'phone'
  if (touch && /macintosh/i.test(ua)) return 'tablet' // iPadOS reports a desktop UA
  return /windows|linux|macintosh|cros/i.test(ua) ? 'laptop' : 'unknown'
}
