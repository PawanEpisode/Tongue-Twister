/** Word comparison — a port of api/twisters/speak/similarity.py (exact, homophone, near, wrong, focus swap). */
import { homophones } from './normalise'

export type WordStatus = 'correct' | 'near' | 'wrong' | 'missed' | 'extra'
export type WordReason = '' | 'homophone' | 'focus_swap'
export type Match = { status: WordStatus; reason: WordReason }

export const NEAR_MIN_LETTERS = 4

export const CORRECT: Match = { status: 'correct', reason: '' }
export const NEAR: Match = { status: 'near', reason: '' }
export const HOMOPHONE: Match = { status: 'near', reason: 'homophone' }
export const FOCUS_SWAP: Match = { status: 'wrong', reason: 'focus_swap' }
export const WRONG: Match = { status: 'wrong', reason: '' }
export const MISSED: Match = { status: 'missed', reason: '' }
export const EXTRA: Match = { status: 'extra', reason: '' }

type Span = [start: number, end: number]

/** If `b` is `a` with one letter substituted, inserted or deleted, the edited span in `a`; else null. */
export function singleEditSpan(a: string, b: string): Span | null {
  if (a === b || Math.abs(a.length - b.length) > 1) return null
  let i = 0
  const limit = Math.min(a.length, b.length)
  while (i < limit && a[i] === b[i]) i++
  if (a.length === b.length)
    return a.slice(i + 1) === b.slice(i + 1) ? [i, i + 1] : null
  if (b.length === a.length + 1)
    return a.slice(i) === b.slice(i + 1) ? [i, i] : null
  return a.slice(i + 1) === b.slice(i) ? [i, i + 1] : null
}

function touchesFocus(
  word: string,
  [start, end]: Span,
  focus: readonly string[],
): boolean {
  for (const sound of focus) {
    if (!sound) continue
    let at = word.indexOf(sound)
    while (at !== -1) {
      const fStart = at,
        fEnd = at + sound.length
      const touches =
        start === end
          ? fStart <= start && start <= fEnd
          : start < fEnd && end > fStart
      if (touches) return true
      at = word.indexOf(sound, at + 1)
    }
  }
  return false
}

export function classify(
  target: string,
  spoken: string,
  focus: readonly string[] = [],
  accepted: readonly string[] = [],
): Match {
  if (spoken === target || accepted.includes(spoken)) return CORRECT
  if (homophones(target).has(spoken)) return HOMOPHONE
  const span = singleEditSpan(target, spoken)
  if (!span) return WRONG
  if (target.length >= 2 && touchesFocus(target, span, focus)) return FOCUS_SWAP
  return Math.min(target.length, spoken.length) >= NEAR_MIN_LETTERS
    ? NEAR
    : WRONG
}
