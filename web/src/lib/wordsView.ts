/** Pure view logic for the Practice page's word lists: searching, sorting, grouping and the meter's tone. */
import type { NailedWord, WeakWord } from './api'

const DAY_MS = 86_400_000

export type WeakSort = 'weakest' | 'missed' | 'due'
export const WEAK_SORTS: { value: WeakSort; label: string }[] = [
  { value: 'weakest', label: 'Weakest first' },
  { value: 'missed', label: 'Most missed' },
  { value: 'due', label: 'Due soonest' },
]

/** Words whose spelling or respelling contains what was typed (case and spacing ignored). */
export function filterWords<T extends { word: string; respelling: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...items]
  return items.filter(
    (w) =>
      w.word.toLowerCase().includes(q) ||
      w.respelling.toLowerCase().includes(q),
  )
}

const dueAt = (w: WeakWord) =>
  w.next_review_at ? Date.parse(w.next_review_at) : -Infinity

/** A sorted copy. Ties keep the server's order (the API already ranks by weakness). */
export function sortWeak(
  items: readonly WeakWord[],
  sort: WeakSort,
): WeakWord[] {
  const out = items.map((w, i) => [w, i] as const)
  const by: Record<WeakSort, (a: WeakWord, b: WeakWord) => number> = {
    weakest: (a, b) => b.weakness - a.weakness,
    missed: (a, b) => b.miss_rate - a.miss_rate || b.seen - a.seen,
    due: (a, b) => {
      const d = dueAt(a) - dueAt(b)
      return Number.isNaN(d) ? 0 : d
    },
  }
  return out.sort(([a, i], [b, j]) => by[sort](a, b) || i - j).map(([w]) => w)
}

/** How many times the word was missed, from the rate and the times it came up. */
export const missedCount = (w: Pick<WeakWord, 'miss_rate' | 'seen'>) =>
  Math.round(w.miss_rate * w.seen)

export const isDueNow = (nextReviewAt: string | null, now = Date.now()) =>
  !nextReviewAt || Date.parse(nextReviewAt) <= now

export type Tone = 'high' | 'mid' | 'low'
/** How worried to look about a word: drives the meter's colour and caption. */
export function weaknessTone(missRate: number): {
  tone: Tone
  label: string
} {
  if (missRate >= 0.67) return { tone: 'high', label: 'Tricky' }
  if (missRate >= 0.34) return { tone: 'mid', label: 'Getting there' }
  return { tone: 'low', label: 'Almost' }
}

export type NailedGroup = {
  key: 'today' | 'yesterday' | 'week' | 'earlier'
  label: string
  items: NailedWord[]
}

const daysAgo = (masteredAt: string, now: number) =>
  Math.max(0, Math.floor((now - Date.parse(masteredAt)) / DAY_MS))

/** Nailed words under Today / Yesterday / Earlier this week / Earlier, newest first, empty groups dropped. */
export function groupNailed(
  items: readonly NailedWord[],
  now = Date.now(),
): NailedGroup[] {
  const groups: NailedGroup[] = [
    { key: 'today', label: 'Today', items: [] },
    { key: 'yesterday', label: 'Yesterday', items: [] },
    { key: 'week', label: 'Earlier this week', items: [] },
    { key: 'earlier', label: 'Earlier', items: [] },
  ]
  for (const w of items) {
    const d = daysAgo(w.mastered_at, now)
    groups[d === 0 ? 0 : d === 1 ? 1 : d < 7 ? 2 : 3].items.push(w)
  }
  return groups.filter((g) => g.items.length)
}

/** Words nailed in the last 7 days among those given. */
export const nailedThisWeek = (
  items: readonly NailedWord[],
  now = Date.now(),
) => items.filter((w) => daysAgo(w.mastered_at, now) < 7).length

/** Share of all the person's trouble words that are now nailed, 0–1 (0 when there are none yet). */
export const nailedShare = (nailed: number, weak: number) =>
  nailed + weak === 0 ? 0 : nailed / (nailed + weak)
