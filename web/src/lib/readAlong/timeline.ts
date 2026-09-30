import { clean, countSyllables, tokenize } from './text'

/** Pause after a token, as a fraction of one base word duration (PRD 02 §5). */
const PAUSE_FACTOR: Record<string, number> = {
  ',': 0.35,
  ';': 0.45,
  ':': 0.45,
  '.': 0.7,
  '?': 0.7,
  '!': 0.7,
  '—': 0.3,
}
const TRAILING_WRAPPERS = /["')\]”’]+$/
const NON_WORD_WEIGHT = 0.5 // emoji / punctuation-only tokens

export const MIN_WPM = 40
export const MAX_WPM = 300
export const clampWpm = (wpm: number) =>
  Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(wpm)))

/** Starting speed when the user hasn't chosen one (PRD 01 §6). */
const WPM_BY_DIFFICULTY: Record<number, number> = {
  1: 90,
  2: 110,
  3: 130,
  4: 150,
}
export const defaultWpm = (difficulty: number) =>
  WPM_BY_DIFFICULTY[difficulty] ?? 110

export type Timeline = {
  tokens: string[]
  /** Start of each word, ms from run start. */
  starts: number[]
  durations: number[]
  /** End of the last word (a trailing pause is not waited for). */
  totalMs: number
  wpm: number
}

function weight(token: string): number {
  const w = clean(token)
  if (!w) return NON_WORD_WEIGHT
  const raw = 0.6 + 0.12 * countSyllables(w) + 0.02 * Math.max(0, w.length - 5)
  return Math.min(2, Math.max(0.7, raw))
}

function pauseFactor(token: string): number {
  const tail = token.replace(TRAILING_WRAPPERS, '').slice(-1)
  return PAUSE_FACTOR[tail] ?? 0
}

/**
 * Per-word schedule for a given speed. Word weights are normalised to their mean so the
 * *average* rate is exactly `wpm` (60 words @ 120 WPM, pauses off ⇒ 30 s).
 */
export function buildTimeline(
  text: string,
  wpm: number,
  { punctuationPauses = true }: { punctuationPauses?: boolean } = {},
): Timeline {
  const tokens = tokenize(text)
  const speed = clampWpm(wpm)
  const base = 60_000 / speed
  const weights = tokens.map(weight)
  const mean = weights.reduce((a, b) => a + b, 0) / (weights.length || 1)

  const durations = weights.map((w) => (base * w) / mean)
  const starts: number[] = []
  let t = 0
  tokens.forEach((token, i) => {
    starts.push(t)
    t += durations[i] + (punctuationPauses ? base * pauseFactor(token) : 0)
  })
  const last = tokens.length - 1
  return {
    tokens,
    starts,
    durations,
    totalMs: last >= 0 ? starts[last] + durations[last] : 0,
    wpm: speed,
  }
}

/** Index of the word being read at `elapsedMs` (binary search; clamps to the valid range). */
export function indexAt(tl: Timeline, elapsedMs: number): number {
  let lo = 0
  let hi = tl.starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (tl.starts[mid] <= elapsedMs) lo = mid
    else hi = mid - 1
  }
  return Math.max(0, lo)
}

/** Position inside the current word, 0..1 (drives continuous scrolling). */
export function fractionAt(tl: Timeline, elapsedMs: number): number {
  const i = indexAt(tl, elapsedMs)
  const d = tl.durations[i] || 1
  return Math.min(1, Math.max(0, (elapsedMs - tl.starts[i]) / d))
}

/** Speed change mid-run: keep the current word (and how far into it) current on the new schedule. */
export function remapElapsed(
  from: Timeline,
  to: Timeline,
  elapsedMs: number,
): number {
  if (!from.tokens.length || from.tokens.length !== to.tokens.length)
    return elapsedMs
  const i = indexAt(from, elapsedMs)
  return to.starts[i] + fractionAt(from, elapsedMs) * to.durations[i]
}

/** ≤ 4 words is too short to be worth one pass: default to three (PRD 02 §8.1). */
export const SHORT_TWISTER_WORDS = 4
export function effectiveLoops(wordCount: number, loopCount: number): number {
  return wordCount <= SHORT_TWISTER_WORDS && loopCount === 1 ? 3 : loopCount
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}
