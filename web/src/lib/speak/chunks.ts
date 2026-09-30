/**
 * Splits a twister into Train chunks (PRD 03 §4.2): 3–5 words, broken at punctuation first and by
 * length second. Chunks are ranges of scoring tokens, the same coordinates the API's `segment` uses.
 */
import { displayWords } from './display'
import type { DisplayWord } from './display'

export const MIN_CHUNK_TOKENS = 3
export const MAX_CHUNK_TOKENS = 5

export type Chunk = {
  /** Scoring-token range [start, end). */
  start: number
  end: number
  /** What to show and say, punctuation included. */
  text: string
}

const CLAUSE_END = /[.,;:!?…—–][)"'”’]*$/
const size = (words: readonly DisplayWord[]) =>
  words.length ? words[words.length - 1].to - words[0].from : 0

/** Cuts a run of words into the fewest near-equal pieces of at most `max` tokens. */
function split(words: DisplayWord[], max: number): DisplayWord[][] {
  const total = size(words)
  const pieces = Math.max(1, Math.ceil(total / max))
  const out: DisplayWord[][] = []
  let current: DisplayWord[] = []
  for (const w of words) {
    current.push(w)
    if (
      out.length < pieces - 1 &&
      w.to - words[0].from >= (total * (out.length + 1)) / pieces
    ) {
      out.push(current)
      current = []
    }
  }
  if (current.length) out.push(current)
  return out
}

const toChunk = (words: readonly DisplayWord[]): Chunk => ({
  start: words[0].from,
  end: words[words.length - 1].to,
  text: words.map((w) => w.text).join(' '),
})

export function chunkTwister(text: string): Chunk[] {
  const words = displayWords(text)
  if (!size(words)) return []

  const clauses: DisplayWord[][] = [[]]
  for (const w of words) {
    clauses[clauses.length - 1].push(w)
    if (CLAUSE_END.test(w.text)) clauses.push([])
  }
  if (!clauses[clauses.length - 1].length) clauses.pop()

  // A clause too short to practise on its own joins its neighbour.
  const merged: DisplayWord[][] = []
  let carry: DisplayWord[] = []
  for (const clause of clauses) {
    carry = [...carry, ...clause]
    if (size(carry) >= MIN_CHUNK_TOKENS) {
      merged.push(carry)
      carry = []
    }
  }
  if (carry.length) {
    if (merged.length) merged[merged.length - 1].push(...carry)
    else merged.push(carry)
  }

  return merged.flatMap((c) => split(c, MAX_CHUNK_TOKENS)).map(toChunk)
}

export type TrainStep = Chunk & { kind: 'chunk' | 'stitch' | 'full' }

/** Every chunk, then pairs of neighbouring chunks stitched together, then the whole twister. */
export function buildTrainPlan(chunks: readonly Chunk[]): TrainStep[] {
  const join = (parts: readonly Chunk[]): Chunk => ({
    start: parts[0].start,
    end: parts[parts.length - 1].end,
    text: parts.map((p) => p.text).join(' '),
  })
  const steps: TrainStep[] = chunks.map((c) => ({ ...c, kind: 'chunk' }))
  if (chunks.length >= 3)
    for (let i = 0; i + 1 < chunks.length; i += 2)
      steps.push({ ...join(chunks.slice(i, i + 2)), kind: 'stitch' })
  if (chunks.length >= 2) steps.push({ ...join(chunks), kind: 'full' })
  return steps
}
