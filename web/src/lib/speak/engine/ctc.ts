/**
 * CTC forward probability and Viterbi forced alignment — a port of api/twisters/speak/engine/ctc.py.
 * Ties prefer the shorter step (stay, advance one, skip a blank) and the last label at the end.
 */

export const NEG_INF = -Infinity

export function logaddexp(a: number, b: number): number {
  if (a === NEG_INF) return b
  if (b === NEG_INF) return a
  const hi = a > b ? a : b
  return hi + Math.log1p(Math.exp(-Math.abs(a - b)))
}

function extended(labels: readonly number[], blank: number): number[] {
  const ext: number[] = new Array<number>(2 * labels.length + 1).fill(blank)
  labels.forEach((label, k) => {
    ext[2 * k + 1] = label
  })
  return ext
}

/** log P(labels | X) summed over every CTC alignment. */
export function ctcLogProb(
  logp: readonly (readonly number[])[],
  labels: readonly number[],
  blank = 0,
): number {
  const frames = logp.length
  if (frames === 0) return labels.length === 0 ? 0 : NEG_INF
  const ext = extended(labels, blank)
  const size = ext.length
  let prev: number[] = new Array<number>(size).fill(NEG_INF)
  prev[0] = logp[0][blank]
  if (size > 1) prev[1] = logp[0][ext[1]]
  for (let t = 1; t < frames; t++) {
    const row = logp[t]
    const cur: number[] = new Array<number>(size).fill(NEG_INF)
    for (let s = 0; s < size; s++) {
      let acc = prev[s]
      if (s >= 1) acc = logaddexp(acc, prev[s - 1])
      if (s >= 2 && ext[s] !== blank && ext[s] !== ext[s - 2])
        acc = logaddexp(acc, prev[s - 2])
      cur[s] = acc !== NEG_INF ? acc + row[ext[s]] : NEG_INF
    }
    prev = cur
  }
  return size > 1 ? logaddexp(prev[size - 1], prev[size - 2]) : prev[0]
}

/** Best path through `labels`: a half-open frame span per label, or null when it cannot fit. */
export function forcedAlign(
  logp: readonly (readonly number[])[],
  labels: readonly number[],
  blank = 0,
): [number, number][] | null {
  const frames = logp.length
  if (labels.length === 0) return []
  if (frames === 0) return null
  const ext = extended(labels, blank)
  const size = ext.length
  let prev: number[] = new Array<number>(size).fill(NEG_INF)
  prev[0] = logp[0][blank]
  prev[1] = logp[0][ext[1]]
  const back: number[][] = [new Array<number>(size).fill(0)]
  for (let t = 1; t < frames; t++) {
    const row = logp[t]
    const cur: number[] = new Array<number>(size).fill(NEG_INF)
    const step: number[] = new Array<number>(size).fill(0)
    for (let s = 0; s < size; s++) {
      let best = prev[s]
      let how = 0
      if (s >= 1 && prev[s - 1] > best) {
        best = prev[s - 1]
        how = 1
      }
      if (
        s >= 2 &&
        ext[s] !== blank &&
        ext[s] !== ext[s - 2] &&
        prev[s - 2] > best
      ) {
        best = prev[s - 2]
        how = 2
      }
      if (best !== NEG_INF) {
        cur[s] = best + row[ext[s]]
        step[s] = how
      }
    }
    prev = cur
    back.push(step)
  }
  let state = size - 1
  if (prev[size - 2] > prev[size - 1]) state = size - 2
  if (prev[state] === NEG_INF) return null
  const path: number[] = new Array<number>(frames).fill(0)
  for (let t = frames - 1; t >= 0; t--) {
    path[t] = state
    state -= back[t][state]
  }
  const spans: [number, number][] = labels.map(() => [-1, -1])
  path.forEach((s, t) => {
    if (s % 2 === 1) {
      const span = spans[(s - 1) / 2]
      if (span[0] < 0) span[0] = t
      span[1] = t + 1
    }
  })
  return spans
}
