/**
 * How the twister text lights up while recording, and when each word was reached (for captions and
 * mistake markers). Pacing = the Read-along schedule; speech = the Speak & score matcher; both = pace guide
 * plus live match.
 */
import type { TextLayer } from './layouts/types'

export type HighlightMode = 'pacing' | 'speech' | 'both'

export const usesPacing = (m: HighlightMode) => m === 'pacing' || m === 'both'
export const usesSpeech = (m: HighlightMode) => m === 'speech' || m === 'both'

/** The text layer for one frame from whichever engines are on. */
export function buildTextLayer(
  words: readonly string[],
  mode: HighlightMode,
  input: {
    /** Read-along index (word being read now). */
    paceIndex: number
    paceActive: boolean
    /** Speak & score: which words have been said right, and the first unsaid one. */
    hits: readonly boolean[]
    speechIndex: number
  },
): TextLayer {
  const speech = usesSpeech(mode)
  const pace = usesPacing(mode)
  const current = pace
    ? input.paceActive
      ? input.paceIndex
      : -1
    : speech
      ? input.speechIndex
      : -1
  return { words, current, hits: speech ? input.hits : [] }
}

/**
 * Records the first moment each word became "said right" (speech-driven timing). Times are the take's
 * active milliseconds; -1 = never reached.
 */
export class HitTimes {
  readonly times: number[]
  constructor(wordCount: number) {
    this.times = new Array<number>(wordCount).fill(-1)
  }
  /** Feed the current hits with the take clock; returns true when a new word was reached. */
  observe(hits: readonly boolean[], elapsedMs: number): boolean {
    let changed = false
    hits.forEach((hit, i) => {
      if (hit && i < this.times.length && this.times[i] < 0) {
        this.times[i] = elapsedMs
        changed = true
      }
    })
    return changed
  }
  reset(): void {
    this.times.fill(-1)
  }
}
