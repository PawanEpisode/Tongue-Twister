const DAY_MS = 86_400_000

/** "today", "yesterday" or "5 days ago" from the time a word was nailed. */
export function nailedLabel(masteredAt: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(masteredAt)) / DAY_MS)
  if (Number.isNaN(days) || days <= 0) return 'today'
  return days === 1 ? 'yesterday' : `${days} days ago`
}
