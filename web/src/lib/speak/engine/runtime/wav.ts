/**
 * Deterministic 16 kHz mono 16-bit PCM WAV. The same bytes are hashed for `audio_sha256` and (if the server asks
 * for a spot-check) uploaded, so the clip the worker re-scores is provably the clip the browser scored (D35).
 */
import { SAMPLE_RATE } from './chunking'

export const WAV_HEADER_BYTES = 44

const clampToInt16 = (x: number) => {
  const v = Math.round(
    Math.max(-1, Math.min(1, Number.isFinite(x) ? x : 0)) * 32767,
  )
  return v
}

export function encodeWav(
  samples: ArrayLike<number>,
  sampleRate = SAMPLE_RATE,
): Uint8Array {
  const dataBytes = samples.length * 2
  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes)
  const view = new DataView(out.buffer)
  const tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i)
  }
  tag(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  tag(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++)
    view.setInt16(WAV_HEADER_BYTES + i * 2, clampToInt16(samples[i]), true)
  return out
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes) // detach from any shared/odd-offset buffer
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export type EncodedClip = {
  bytes: Uint8Array
  sha256: string
  durationMs: number
}

export async function encodeClip(
  samples: ArrayLike<number>,
): Promise<EncodedClip> {
  const bytes = encodeWav(samples)
  return {
    bytes,
    sha256: await sha256Bytes(bytes),
    durationMs: Math.round((samples.length * 1000) / SAMPLE_RATE),
  }
}
