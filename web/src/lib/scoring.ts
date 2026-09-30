/**
 * Client-side scoring for live highlighting and the offline / guest fallback.
 * The maths lives in ./speak (a port of the API's scoring v2, kept equal by shared test vectors);
 * this file is the small surface the practice UI uses.
 */
import { displayStatuses, displayWords, rowsFromAligned } from './speak/display'
import type { DisplayWord, WordRow } from './speak/display'
import { evaluate } from './speak/score'
import type { Evaluation } from './speak/score'
import type { WordStatus } from './speak/similarity'

export const SCORE_VERSION = 2
const LIVE_DURATION_MS = 60_000 // live highlighting ignores timing

export type LocalScore = {
  score: number
  accuracy: number
  wpm: number
  evaluation: Evaluation
  rows: WordRow[]
  display: DisplayWord[]
  statuses: (WordStatus | null)[]
}

export type ScoreInput = {
  text: string
  spoken: string
  durationMs: number
  longPauseMs?: number
  difficulty: number
  focusSounds?: readonly string[]
}

export function scoreLocally(i: ScoreInput): LocalScore {
  const evaluation = evaluate(i.text, i.spoken, {
    durationMs: i.durationMs,
    longPauseMs: i.longPauseMs,
    difficulty: i.difficulty,
    focusSounds: i.focusSounds,
  })
  const display = displayWords(i.text)
  const rows = rowsFromAligned(evaluation.words)
  return {
    score: evaluation.score.score,
    accuracy: evaluation.score.accuracy,
    wpm: evaluation.score.wpm,
    evaluation,
    rows,
    display,
    statuses: displayStatuses(display, rows),
  }
}

/** Which displayed words the speaker has already got right (correct or near) — drives live highlighting. */
export function liveHits(
  text: string,
  spoken: string,
  focusSounds: readonly string[] = [],
): boolean[] {
  const { statuses } = scoreLocally({
    text,
    spoken,
    durationMs: LIVE_DURATION_MS,
    difficulty: 2,
    focusSounds,
  })
  // A word with nothing to say (a dash, an emoji) needs no speaking, so it never blocks auto-finish.
  return statuses.map((s) => s === null || s === 'correct' || s === 'near')
}
