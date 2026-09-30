/**
 * Turns a finished take into what the review page shows: score (when we heard the speaker), per-word
 * verdicts, timings, mistake markers and caption cues. Reuses the Speak & score scorer, never a copy.
 */
import { scoreLocally } from '../scoring'
import { displayWords } from '../speak/display'
import type { DisplayWord, WordRow } from '../speak/display'
import type { WordStatus } from '../speak/similarity'
import { buildCues } from './captions'
import type { Cue } from './captions'
import { buildMarkers } from './markers'
import type { Marker } from './markers'
import { resolveTimings } from './timings'
import type { WordTiming } from './timings'
import type { StoredAnalysis } from './chunkStore'

export type TakeAnalysis = {
  /** False for pacing-only takes: nothing was heard, so there is nothing to score. */
  scored: boolean
  score: number
  accuracy: number
  wpm: number
  display: DisplayWord[]
  statuses: (WordStatus | null)[]
  rows: WordRow[]
  timings: WordTiming[]
  markers: Marker[]
  cues: Cue[]
}

export function analyseTake(input: {
  text: string
  difficulty: number
  focusSounds: readonly string[]
  durationMs: number
  /** What the recogniser heard (speech-driven takes); empty for pacing only. */
  stored: StoredAnalysis | null
  /** How long the speaker actually talked, for the WPM; falls back to the take length. */
  spokenMs?: number
}): TakeAnalysis {
  const display = displayWords(input.text)
  const words = display.map((d) => d.text)
  const stored = input.stored
  const timings = resolveTimings({
    words,
    hitTimes: stored?.hitTimes ?? null,
    paceStarts: stored?.paceStarts ?? null,
    durationMs: input.durationMs,
  })
  const cues = buildCues(timings)
  const transcript = stored?.transcript.trim() ?? ''
  if (!transcript)
    return {
      scored: false,
      score: 0,
      accuracy: 0,
      wpm: 0,
      display,
      statuses: display.map(() => null),
      rows: [],
      timings,
      markers: [],
      cues,
    }
  const spoken = Math.max(300, Math.round(input.spokenMs ?? input.durationMs))
  const local = scoreLocally({
    text: input.text,
    spoken: transcript,
    durationMs: spoken,
    longPauseMs: Math.min(stored?.longPauseMs ?? 0, spoken),
    difficulty: input.difficulty,
    focusSounds: input.focusSounds,
  })
  return {
    scored: true,
    score: local.score,
    accuracy: local.accuracy,
    wpm: local.wpm,
    display,
    statuses: local.statuses,
    rows: local.rows,
    timings,
    markers: buildMarkers(timings, local.statuses, input.durationMs),
    cues,
  }
}

export type DeliveryHints = {
  /** Pace against the twister's target speed, e.g. "A little fast: 152 wpm vs a 130 target". */
  pace: string | null
  /** The longest silence in the take, in seconds (null when it was short). */
  longestPauseS: number | null
  fillers: number
}

const FILLERS = new Set(['um', 'uh', 'er', 'erm', 'hmm', 'ah'])

export function deliveryHints(input: {
  wpm: number
  targetWpm: number
  longPauseMs: number
  transcript: string
}): DeliveryHints {
  const { wpm, targetWpm } = input
  let pace: string | null = null
  if (wpm > 0 && targetWpm > 0) {
    const ratio = wpm / targetWpm
    if (ratio > 1.15)
      pace = `A little fast: ${Math.round(wpm)} wpm against a ${targetWpm} wpm target.`
    else if (ratio < 0.85)
      pace = `Nice and steady: ${Math.round(wpm)} wpm, under the ${targetWpm} wpm target.`
    else pace = `Right on pace: ${Math.round(wpm)} wpm.`
  }
  const fillers = input.transcript
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => FILLERS.has(w.replace(/[^a-z]/g, ''))).length
  return {
    pace,
    longestPauseS:
      input.longPauseMs >= 700
        ? Math.round(input.longPauseMs / 100) / 10
        : null,
    fillers,
  }
}
