/**
 * Scoring v2 — a port of api/twisters/speak/scoring.py + pipeline.evaluate.
 * credit correct 1 · near 0.6 · wrong/missed 0 · extra −0.15 (capped −0.5)
 * score = round(100·(0.7 accuracy + 0.2 speed + 0.1 fluency)), capped at 79 by a focus swap.
 */
import { align, mergeSplitCompounds } from './align'
import type { Aligned } from './align'
import { tokenise } from './normalise'
import type { WordStatus } from './similarity'

const CREDIT: Record<WordStatus, number> = {
  correct: 1,
  near: 0.6,
  wrong: 0,
  missed: 0,
  extra: -0.15,
}
const EXTRA_PENALTY_CAP = -0.5
const SPEED_MIN_ACCURACY = 0.6
const PAUSE_SHARE = 0.35
const WEIGHTS = [0.7, 0.2, 0.1] as const
export const FOCUS_SCORE_CAP = 79
export const MIN_DURATION_MS = 500
export const MAX_SPOKEN_TOKENS = 800
export const REFERENCE_WPM: Record<number, number> = {
  1: 110,
  2: 130,
  3: 150,
  4: 170,
}

export type Counts = Record<WordStatus, number>
export type Score = {
  accuracy: number
  speed: number
  fluency: number
  completeness: number
  wpm: number
  score: number
  focusGated: boolean
  counts: Counts
}
export type Evaluation = {
  words: Aligned[]
  targetWords: number
  spokenWords: number
  score: Score
}

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const round = (v: number, places: number) =>
  Math.round(v * 10 ** places) / 10 ** places

export function evaluate(
  targetText: string,
  transcript: string,
  opts: {
    durationMs: number
    longPauseMs?: number
    difficulty?: number
    focusSounds?: readonly string[]
  },
): Evaluation {
  const targets = tokenise(targetText)
  const spoken = tokenise(transcript).slice(0, MAX_SPOKEN_TOKENS)
  const focus = (opts.focusSounds ?? []).map((f) => f.toLowerCase())
  const words = align(targets, mergeSplitCompounds(targets, spoken), { focus })
  const score = compute(words, {
    targetWords: targets.length,
    spokenWords: spoken.length,
    durationMs: opts.durationMs,
    longPauseMs: Math.min(opts.longPauseMs ?? 0, opts.durationMs),
    difficulty: opts.difficulty ?? 2,
  })
  return {
    words,
    targetWords: targets.length,
    spokenWords: spoken.length,
    score,
  }
}

export function compute(
  words: readonly Aligned[],
  p: {
    targetWords: number
    spokenWords: number
    durationMs: number
    longPauseMs: number
    difficulty: number
  },
): Score {
  const counts: Counts = { correct: 0, near: 0, wrong: 0, missed: 0, extra: 0 }
  for (const w of words) counts[w.match.status]++
  const extras = Math.max(EXTRA_PENALTY_CAP, counts.extra * CREDIT.extra)
  const credit = counts.correct * CREDIT.correct + counts.near * CREDIT.near
  const accuracy = p.targetWords ? clamp((credit + extras) / p.targetWords) : 0
  const completeness = p.targetWords
    ? clamp((counts.correct + counts.near) / p.targetWords)
    : 0

  const duration = Math.max(p.durationMs, MIN_DURATION_MS)
  const wpm = p.spokenWords / (duration / 60000)
  const reference = REFERENCE_WPM[p.difficulty] ?? REFERENCE_WPM[2]
  const speed = accuracy >= SPEED_MIN_ACCURACY ? clamp(wpm / reference) : 0
  const fluency = 1 - clamp(p.longPauseMs / (PAUSE_SHARE * duration))

  const raw =
    100 * (WEIGHTS[0] * accuracy + WEIGHTS[1] * speed + WEIGHTS[2] * fluency)
  const gated = words.some((w) => w.match.reason === 'focus_swap')
  const uncapped = Math.floor(raw + 0.5) // round half up, as on the server
  return {
    accuracy: round(accuracy, 4),
    speed: round(speed, 4),
    fluency: round(fluency, 4),
    completeness: round(completeness, 4),
    wpm: round(wpm, 1),
    score: gated ? Math.min(uncapped, FOCUS_SCORE_CAP) : uncapped,
    focusGated: gated && uncapped > FOCUS_SCORE_CAP,
    counts,
  }
}

/** Mirrors the API's MIN_ENGINE_CONFIDENCE: below this the take is not scored or saved. */
export const MIN_ENGINE_CONFIDENCE = 0.45
export type Unscorable = 'no_speech' | 'low_confidence'

/**
 * Why a take must be answered with "we couldn't hear you clearly" instead of a score.
 * The device-only checks (audio quality, noise) belong to the server and the neural engine.
 */
export function unscorableReason(
  evaluation: Pick<Evaluation, 'spokenWords'>,
  confidence?: number | null,
): Unscorable | null {
  if (evaluation.spokenWords === 0) return 'no_speech'
  if (confidence != null && confidence < MIN_ENGINE_CONFIDENCE)
    return 'low_confidence'
  return null
}
