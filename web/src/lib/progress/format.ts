/** Plain-language number formatting shared by the stats cards. */

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return ms > 0 ? '<1 min' : '0 min'
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export const formatPercent = (fraction: number): string =>
  `${Math.round(fraction * 100)}%`

/** One decimal, dropping a trailing ".0". */
export const formatScore = (score: number | null): string =>
  score == null ? '—' : String(Math.round(score * 10) / 10)

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`
