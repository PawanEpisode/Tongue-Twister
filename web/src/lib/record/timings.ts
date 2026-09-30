/** Word timings for captions and mistake markers, from whichever signal the take has. Pure. */

export type WordTiming = {
  index: number
  word: string
  startMs: number
  endMs: number
}

/** The recogniser reports a word after it is said; captions start a little earlier than the hit. */
export const SPEECH_LAG_MS = 350
const MIN_WORD_MS = 200
/** Trust speech hits only when enough of the twister was actually matched. */
const MIN_HIT_SHARE = 0.4

export type TimingInput = {
  words: readonly string[]
  /** ms of first correct hit per word, -1 = never (speech-driven). */
  hitTimes?: readonly number[] | null
  /** Read-along word start times (pacing). */
  paceStarts?: readonly number[] | null
  durationMs: number
}

function interpolate(starts: (number | null)[], durationMs: number): number[] {
  const out = [...starts]
  let i = 0
  while (i < out.length) {
    if (out[i] !== null) {
      i++
      continue
    }
    let j = i
    while (j < out.length && out[j] === null) j++
    const left = i > 0 ? (out[i - 1] as number) : 0
    const right = j < out.length ? (out[j] as number) : durationMs
    const gap = j - i + 1
    for (let k = i; k < j; k++)
      out[k] = left + ((right - left) * (k - i + 1)) / gap
    i = j
  }
  return out as number[]
}

export function resolveTimings(input: TimingInput): WordTiming[] {
  const { words, durationMs } = input
  const n = words.length
  if (!n || durationMs <= 0) return []

  const hits = input.hitTimes
  const reached = hits ? hits.filter((t) => t >= 0).length : 0
  let starts: number[]
  if (hits && hits.length === n && reached / n >= MIN_HIT_SHARE) {
    starts = interpolate(
      hits.map((t) => (t >= 0 ? Math.max(0, t - SPEECH_LAG_MS) : null)),
      durationMs,
    )
  } else if (input.paceStarts && input.paceStarts.length === n) {
    starts = [...input.paceStarts]
  } else {
    starts = words.map((_, i) => (durationMs * i) / n)
  }

  // Monotonic and inside the take.
  let prev = 0
  starts = starts.map((s) => {
    prev = Math.min(durationMs, Math.max(prev, s))
    return prev
  })
  return words.map((word, index) => {
    const startMs = starts[index]
    const next = index + 1 < n ? starts[index + 1] : durationMs
    const end = Math.min(durationMs, Math.max(startMs + MIN_WORD_MS, next))
    return { index, word, startMs: Math.round(startMs), endMs: Math.round(end) }
  })
}
