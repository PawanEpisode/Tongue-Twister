/**
 * Judging one spoken take of one drill word. The verdict on screen and the take we save must agree: the server
 * decides what is "nailed" from the saved take (it scores the transcript, drops a take under
 * MIN_ENGINE_CONFIDENCE and only graduates a word at DRILL_MIN_CONFIDENCE).
 *
 * The browser's confidence is a poor yardstick for one isolated word: it is routinely 0.2–0.5 for a word it got
 * exactly right (and Chrome shares it between alternatives). The evidence we trust is the *text*: one of the
 * recogniser's guesses is the word, or sounds like it. So a take whose guesses contain the word passes unless
 * the recogniser was almost certain it heard nothing usable, and is saved with no confidence (which the server
 * reads as "the browser did not say", exactly as for browsers that report none) so a correct take is not
 * discarded or left un-nailed by a number that means little here.
 */
import { scoreLocally } from '../scoring'
import type { Heard, SpeechResult } from '../speech'
import { unscorableReason } from './score'
import { soundsLike } from './soundsLike'

/** Below this the recogniser itself doubted it heard a word at all: ask for another go. */
export const DRILL_FLOOR_CONFIDENCE = 0.25

/**
 * A guess that is only *near* the word (one letter off, or a sound-alike) is weaker evidence than the word itself,
 * and it is exactly what a recogniser invents out of background noise. So it must come with a real confidence at
 * or above this; "the browser did not say" is enough for the exact word, not for a near one.
 */
export const CLOSE_MIN_CONFIDENCE = 0.4

export type DrillVerdict =
  | {
      kind: 'passed'
      /** Passed on a sound-alike ("cease" for "sees"), not an exact match. */
      close: boolean
      /** What to save: the guess that matched, so the server scores what the learner meant. */
      transcript: string
      /** Always null: see the note at the top of this file. */
      confidence: null
    }
  | { kind: 'missed'; transcript: string; confidence: number | null }
  | { kind: 'unclear'; confidence: number | null }

/**
 * How sure the recogniser is that the take was one of `hits`. With several alternatives Chrome shares its
 * probability between them (the first guess of "sliding" may be 0.4 with the rest spread over "slighting",
 * "sliding in"…), so the chance the learner said the word is the *sum* over the guesses that are the word.
 */
export function confidenceOf(
  hits: readonly Heard[],
  fallback: number | null,
): number | null {
  const known = hits.filter((h) => h.confidence != null)
  if (!known.length) return fallback
  const mass = Math.min(
    1,
    known.reduce((n, h) => n + (h.confidence as number), 0),
  )
  return Math.max(mass, fallback ?? 0)
}

export function judgeDrill(
  word: string,
  r: Pick<
    SpeechResult,
    'transcript' | 'alternatives' | 'confidence' | 'durationMs' | 'longPauseMs'
  >,
): DrillVerdict {
  const score = (spoken: string) =>
    scoreLocally({
      text: word,
      spoken,
      durationMs: r.durationMs,
      longPauseMs: r.longPauseMs,
      difficulty: 2,
    })
  const statusOf = (spoken: string) =>
    score(spoken).rows.find((row) => row.targetIndex === 0)?.status
  // Blank guesses carry no evidence: a take with nothing but blanks heard nothing.
  const guesses: Heard[] = (
    r.alternatives.length
      ? r.alternatives
      : [{ text: r.transcript, confidence: r.confidence }]
  ).filter((g) => g.text.trim())
  const plausible = (c: number | null) =>
    c == null || c >= DRILL_FLOOR_CONFIDENCE
  const solid = (c: number | null) => c != null && c >= CLOSE_MIN_CONFIDENCE
  // Only the recogniser's first guess may stand in for the word by being near it; lower-ranked guesses must be
  // the word itself, or five junk guesses from a noisy room would get five chances to land close.
  const top = guesses[0]

  // The word itself, among any of the recogniser's guesses.
  const exact = guesses.filter((g) => statusOf(g.text) === 'correct')
  const exactConfidence = confidenceOf(exact, r.confidence)
  if (exact.length && plausible(exactConfidence))
    return {
      kind: 'passed',
      close: false,
      transcript: exact[0].text,
      confidence: null,
    }

  let hitConfidence = exactConfidence
  if (!exact.length && top) {
    // One letter off ("sowing" for "showing") counts as near in the shared scoring, but it is the recogniser's
    // own best guess that has to be near: and the screen says so.
    if (statusOf(top.text) === 'near') {
      hitConfidence = confidenceOf([top], r.confidence)
      if (solid(hitConfidence))
        return {
          kind: 'passed',
          close: true,
          transcript: top.text,
          confidence: null,
        }
    } else if (soundsLike(word, top.text)) {
      // Recognisers hand back the nearest common word ("sees" → "cease", "shelves" → "sales"). A sound-alike
      // counts, but the screen says so, and we save the word they were aiming for.
      hitConfidence = confidenceOf([top], r.confidence)
      if (solid(hitConfidence))
        return {
          kind: 'passed',
          close: true,
          transcript: word,
          confidence: null,
        }
    }
  }

  const unscorable = unscorableReason(
    score(r.transcript).evaluation,
    exact.length ? hitConfidence : r.confidence,
  )
  if (unscorable) return { kind: 'unclear', confidence: hitConfidence }
  return { kind: 'missed', transcript: r.transcript, confidence: r.confidence }
}
