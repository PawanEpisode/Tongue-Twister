/**
 * Needleman–Wunsch alignment — a port of api/twisters/speak/alignment.py.
 * Integer costs and the same tie-break (diagonal, then missed, then extra) keep both sides identical.
 */
import { EXTRA, MISSED, classify } from './similarity'
import type { Match } from './similarity'

const COST_NEAR = 3
const COST_WRONG = 10
const COST_GAP = 10

/** One recognised word; `raw` differs from `text` when several spoken words were merged. */
export type SpokenToken = { text: string; index: number; raw?: string }
export type Aligned = {
  targetIndex: number | null
  spokenIndex: number | null
  targetWord: string
  spokenWord: string
  match: Match
}

/** 'sea' + 'shells' -> 'seashells' when the twister has that compound. */
export function mergeSplitCompounds(
  targets: readonly string[],
  spoken: readonly string[],
): SpokenToken[] {
  const wanted = new Set(targets)
  const out: SpokenToken[] = []
  for (let i = 0; i < spoken.length;) {
    const joined = i + 1 < spoken.length ? spoken[i] + spoken[i + 1] : ''
    if (joined && wanted.has(joined) && !wanted.has(spoken[i])) {
      out.push({ text: joined, index: i, raw: `${spoken[i]} ${spoken[i + 1]}` })
      i += 2
    } else {
      out.push({ text: spoken[i], index: i })
      i += 1
    }
  }
  return out
}

const pairCost = (m: Match) =>
  m.status === 'correct' ? 0 : m.status === 'near' ? COST_NEAR : COST_WRONG

export function align(
  targets: readonly string[],
  spoken: readonly SpokenToken[],
  options: {
    focus?: readonly string[]
    accepted?: Record<string, readonly string[]>
  } = {},
): Aligned[] {
  const { focus = [], accepted = {} } = options
  const cache = new Map<string, Match>()
  const compare = (t: string, s: string): Match => {
    const key = `${t}\u0000${s}`
    let hit = cache.get(key)
    if (!hit) cache.set(key, (hit = classify(t, s, focus, accepted[t] ?? [])))
    return hit
  }

  const n = targets.length,
    m = spoken.length
  const cost = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )
  for (let i = n - 1; i >= 0; i--) cost[i][m] = (n - i) * COST_GAP
  for (let j = m - 1; j >= 0; j--) cost[n][j] = (m - j) * COST_GAP
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      cost[i][j] = Math.min(
        cost[i + 1][j + 1] + pairCost(compare(targets[i], spoken[j].text)),
        cost[i + 1][j] + COST_GAP,
        cost[i][j + 1] + COST_GAP,
      )

  const out: Aligned[] = []
  let i = 0,
    j = 0
  while (i < n || j < m) {
    if (i < n && j < m) {
      const match = compare(targets[i], spoken[j].text)
      if (cost[i][j] === cost[i + 1][j + 1] + pairCost(match)) {
        const tok = spoken[j]
        out.push({
          targetIndex: i,
          spokenIndex: tok.index,
          targetWord: targets[i],
          spokenWord: tok.raw ?? tok.text,
          match,
        })
        i++
        j++
        continue
      }
    }
    if (i < n && cost[i][j] === cost[i + 1][j] + COST_GAP) {
      out.push({
        targetIndex: i,
        spokenIndex: null,
        targetWord: targets[i],
        spokenWord: '',
        match: MISSED,
      })
      i++
    } else {
      const tok = spoken[j]
      out.push({
        targetIndex: null,
        spokenIndex: tok.index,
        targetWord: '',
        spokenWord: tok.raw ?? tok.text,
        match: EXTRA,
      })
      j++
    }
  }
  return out
}

export { classify }
