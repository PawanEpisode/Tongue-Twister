/**
 * Long clips run in overlapping windows so memory stays bounded (docs/features/13 section 3.6): 30 s windows
 * with 1 s of overlap, the posteriors stitched at the middle of each overlap. Window length and step are
 * multiples of the 320-sample (20 ms) model stride, so frame indexes line up exactly.
 */
export const SAMPLE_RATE = 16_000
export const STRIDE = 320
export const CHUNK_SAMPLES = 30 * SAMPLE_RATE
export const OVERLAP_SAMPLES = 1 * SAMPLE_RATE

export type Window = { start: number; end: number }

export function planChunks(
  total: number,
  chunk = CHUNK_SAMPLES,
  overlap = OVERLAP_SAMPLES,
): Window[] {
  if (chunk % STRIDE || overlap % STRIDE || overlap >= chunk)
    throw new RangeError(
      'chunk and overlap must be multiples of the stride, overlap < chunk',
    )
  if (total <= chunk) return [{ start: 0, end: total }]
  const step = chunk - overlap
  const out: Window[] = []
  for (let start = 0; ; start += step) {
    const end = Math.min(total, start + chunk)
    out.push({ start, end })
    if (end === total) return out
  }
}

/** Frames wav2vec2's conv stack produces for `samples` input samples. */
export const framesFor = (samples: number) =>
  samples < 400 ? 0 : Math.floor((samples - 400) / STRIDE) + 1

export type Part = { startFrame: number; frames: number; logits: Float32Array }

/** Concatenate window outputs, cutting each overlap at its midpoint. */
export function stitch(
  parts: Part[],
  vocab: number,
): { logits: Float32Array; frames: number } {
  if (parts.length === 0) return { logits: new Float32Array(0), frames: 0 }
  const keep = parts.map((p, i) => {
    const lo = i === 0 ? p.startFrame : mid(parts[i - 1], p)
    const hi =
      i === parts.length - 1 ? p.startFrame + p.frames : mid(p, parts[i + 1])
    return { lo, hi }
  })
  const first = keep[0].lo
  const last = keep[keep.length - 1].hi
  const out = new Float32Array((last - first) * vocab)
  parts.forEach((p, i) => {
    const { lo, hi } = keep[i]
    if (hi <= lo) return
    const from = (lo - p.startFrame) * vocab
    const to = (hi - p.startFrame) * vocab
    out.set(p.logits.subarray(from, to), (lo - first) * vocab)
  })
  return { logits: out, frames: last - first }
}

const mid = (a: Part, b: Part) =>
  Math.floor((b.startFrame + a.startFrame + a.frames) / 2)
