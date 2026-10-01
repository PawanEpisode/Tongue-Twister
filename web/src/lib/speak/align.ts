/**
 * Needleman–Wunsch alignment — a port of api/twisters/speak/alignment.py.
 * Integer costs and the same tie-break (diagonal, then missed, then extra) keep both sides identical.
 */
import { EXTRA, MISSED, classify } from './similarity'
import type { Match } from './similarity'

const COST_NEAR = 3
const COST_WRONG = 10
const COST_GAP = 10

/**
 * Order lock: after the cheapest alignment is found, a pair may only sit this many target words
 * past the last accepted one. A longer jump is believed only when a run of correct words follows
 * (the speaker really resumed there); otherwise it is an echo of a repeated word and is undone.
 */
export const MAX_SKIP = 6
export const RESYNC_RUN = 3

/** One recognised word; `raw` differs from `text` when several spoken words were merged. */
export type SpokenToken = { text: string; index: number; raw?: string }
export type Aligned = {
  targetIndex: number | null
  spokenIndex: number | null
  targetWord: string
  spokenWord: string
  match: Match
}

/** Words a recogniser writes where a contraction's "'s" was said: "Sam is", "Sam has", "Sam s". */
const CONTRACTION_TAILS = new Set(['is', 'has', 's'])

/** The twister word that `spoken[i]` and `spoken[i + 1]` jointly say, or ''. */
function merged(spoken: readonly string[], i: number, wanted: Set<string>) {
  if (i + 1 >= spoken.length || wanted.has(spoken[i])) return ''
  const compound = spoken[i] + spoken[i + 1] // 'sea' + 'shells' -> 'seashells'
  if (wanted.has(compound)) return compound
  const contraction = `${spoken[i]}'s` // 'sam' + 'is' -> "sam's"
  return CONTRACTION_TAILS.has(spoken[i + 1]) && wanted.has(contraction)
    ? contraction
    : ''
}

/** Rejoins words a recogniser splits: 'sea' + 'shells' -> 'seashells', 'sam' + 'is' -> "sam's". */
export function mergeSplitCompounds(
  targets: readonly string[],
  spoken: readonly string[],
): SpokenToken[] {
  const wanted = new Set(targets)
  const out: SpokenToken[] = []
  for (let i = 0; i < spoken.length;) {
    const joined = merged(spoken, i, wanted)
    if (joined) {
      out.push({ text: joined, index: i, raw: `${spoken[i]} ${spoken[i + 1]}` })
      i += 2
    } else {
      out.push({ text: spoken[i], index: i })
      i += 1
    }
  }
  return out
}

const isPair = (r: Aligned) => r.targetIndex !== null && r.spokenIndex !== null
const isCredited = (r: Aligned) =>
  isPair(r) && (r.match.status === 'correct' || r.match.status === 'near')

/** Splits a pair that broke the order lock into the target it did not earn and the word that strayed. */
function demote(r: Aligned): Aligned[] {
  return [
    {
      targetIndex: r.targetIndex,
      spokenIndex: null,
      targetWord: r.targetWord,
      spokenWord: '',
      match: MISSED,
    },
    {
      targetIndex: null,
      spokenIndex: r.spokenIndex,
      targetWord: '',
      spokenWord: r.spokenWord,
      match: EXTRA,
    },
  ]
}

/** Keeps credit in reading order: a repeated word cannot be claimed far from where the speaker is. */
export function enforceOrder(rows: readonly Aligned[]): Aligned[] {
  const out: Aligned[] = []
  let last = -1
  rows.forEach((r, k) => {
    if (!isPair(r)) return void out.push(r)
    const jump = r.targetIndex! - last - 1
    let run = 0
    while (k + run < rows.length && isCredited(rows[k + run])) run++
    if (jump <= MAX_SKIP || (isCredited(r) && run >= RESYNC_RUN)) {
      last = r.targetIndex!
      out.push(r)
    } else out.push(...demote(r))
  })
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
  return enforceOrder(out)
}

export { classify }
