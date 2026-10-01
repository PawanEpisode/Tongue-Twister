/** GOP-style features and the alignment-free substitution / deletion tests — a port of engine/gop.py. */
import { NEG_INF, ctcLogProb } from './ctc'

export type Features = {
  lpp: number
  lpr: number
  peakLp: number
  heard: number
}

export function features(
  logp: readonly (readonly number[])[],
  window: readonly [number, number],
  span: readonly [number, number],
  label: number,
  blank: number,
  radius: number,
): Features {
  let peak = span[0]
  for (let t = span[0]; t < span[1]; t++)
    if (logp[t][label] > logp[peak][label]) peak = t
  const start = Math.max(window[0], peak - radius)
  const end = Math.min(window[1], peak + radius + 1)
  const count = end - start
  const vocabSize = logp[0].length
  let targetSum = 0
  let rivalSum = 0
  const classSum: number[] = new Array<number>(vocabSize).fill(0)
  for (let t = start; t < end; t++) {
    const row = logp[t]
    targetSum += row[label]
    let rival = NEG_INF
    for (let q = 0; q < vocabSize; q++) {
      if (q === blank) continue
      classSum[q] += row[q]
      if (q !== label && row[q] > rival) rival = row[q]
    }
    rivalSum += rival
  }
  const lpp = targetSum / count
  let heard = -1
  for (let q = 0; q < vocabSize; q++)
    if (q !== blank && (heard < 0 || classSum[q] > classSum[heard])) heard = q
  return { lpp, lpr: lpp - rivalSum / count, peakLp: logp[peak][label], heard }
}

export type Tests = {
  base: number
  subDelta: number | null
  subLabel: number | null
  delDelta: number | null
}

/** delta(q) = log P(y|X) − log P(y[i→q]|X); strongly negative means the audio fits q better than y. */
export function substitutionTests(
  logp: readonly (readonly number[])[],
  sequence: readonly number[],
  position: number,
  candidates: readonly number[],
  blank: number,
): Tests {
  const base = ctcLogProb(logp, sequence, blank)
  let best: number | null = null
  let bestLabel: number | null = null
  for (const q of candidates) {
    const swapped = [
      ...sequence.slice(0, position),
      q,
      ...sequence.slice(position + 1),
    ]
    const delta = base - ctcLogProb(logp, swapped, blank)
    if (best === null || delta < best) {
      best = delta
      bestLabel = q
    }
  }
  let deletion: number | null = null
  if (sequence.length > 1)
    deletion =
      base -
      ctcLogProb(
        logp,
        [...sequence.slice(0, position), ...sequence.slice(position + 1)],
        blank,
      )
  return { base, subDelta: best, subLabel: bestLabel, delDelta: deletion }
}
