/** Pass 1 of the two-pass alignment — a port of api/twisters/speak/engine/decode.py. */

const COST_SUB = 10
const COST_GAP = 10

export type Segment = [label: number, start: number, end: number]
export type Row = [expected: number | null, heard: number | null]

/** Argmax per frame, repeats collapsed, blanks dropped. */
export function greedyDecode(
  logp: readonly (readonly number[])[],
  blank = 0,
): Segment[] {
  const out: Segment[] = []
  let last = blank
  logp.forEach((row, t) => {
    let best = 0
    for (let q = 1; q < row.length; q++) if (row[q] > row[best]) best = q
    if (best === blank) {
      last = blank
      return
    }
    if (best === last && out.length) out[out.length - 1][2] = t + 1
    else out.push([best, t, t + 1])
    last = best
  })
  return out
}

/**
 * Phoneme edit alignment. Integer costs; ties resolve diagonal first, then a missed expected phone, then an
 * extra heard one, walking forward so a repeated phrase is credited to its first repetition.
 */
export function editAlign(
  expected: readonly string[],
  heard: readonly string[],
): Row[] {
  const n = expected.length
  const m = heard.length
  const cost: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )
  for (let i = n - 1; i >= 0; i--) cost[i][m] = (n - i) * COST_GAP
  for (let j = m - 1; j >= 0; j--) cost[n][j] = (m - j) * COST_GAP
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const sub = expected[i] === heard[j] ? 0 : COST_SUB
      cost[i][j] = Math.min(
        cost[i + 1][j + 1] + sub,
        cost[i + 1][j] + COST_GAP,
        cost[i][j + 1] + COST_GAP,
      )
    }
  }
  const rows: Row[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m) {
      const sub = expected[i] === heard[j] ? 0 : COST_SUB
      if (cost[i][j] === cost[i + 1][j + 1] + sub) {
        rows.push([i, j])
        i++
        j++
        continue
      }
    }
    if (i < n && cost[i][j] === cost[i + 1][j] + COST_GAP) {
      rows.push([i, null])
      i++
    } else {
      rows.push([null, j])
      j++
    }
  }
  return rows
}

/** Runs of at least `minimum` consecutive extra heard phones (unexpected speech). */
export function extraRuns(rows: readonly Row[], minimum: number): number {
  let runs = 0
  let length = 0
  for (const [i, j] of rows) {
    if (i === null && j !== null) {
      length++
      continue
    }
    if (length >= minimum) runs++
    length = 0
  }
  if (length >= minimum) runs++
  return runs
}

/** A half-open frame window per word (null when nothing was matched to it); windows never overlap. */
export function wordWindows(
  rows: readonly Row[],
  wordOf: readonly number[],
  segments: readonly Segment[],
  words: number,
  frames: number,
  pad: number,
): ([number, number] | null)[] {
  const core: ([number, number] | null)[] = new Array<null>(words).fill(null)
  for (const [i, j] of rows) {
    if (i === null || j === null) continue
    const [, start, end] = segments[j]
    const w = wordOf[i]
    const c = core[w]
    if (c === null) core[w] = [start, end]
    else {
      c[0] = Math.min(c[0], start)
      c[1] = Math.max(c[1], end)
    }
  }
  const windows = core.map((c) =>
    c === null
      ? null
      : ([Math.max(0, c[0] - pad), Math.min(frames, c[1] + pad)] as [
          number,
          number,
        ]),
  )
  let last: [number, number] | null = null
  for (const window of windows) {
    if (window === null) continue
    if (last !== null && window[0] < last[1]) {
      const mid = Math.floor((window[0] + last[1]) / 2)
      last[1] = mid
      window[0] = mid
    }
    last = window
  }
  return windows
}
