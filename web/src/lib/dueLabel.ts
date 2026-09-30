const DAY_MS = 86_400_000

/** "due now", "due tomorrow" or "due in 5 days" from the API's next review time (null = never scheduled). */
export function dueLabel(
  nextReviewAt: string | null,
  now = Date.now(),
): string {
  if (!nextReviewAt) return 'due now'
  const days = Math.ceil((Date.parse(nextReviewAt) - now) / DAY_MS)
  if (Number.isNaN(days) || days <= 0) return 'due now'
  return days === 1 ? 'due tomorrow' : `due in ${days} days`
}
