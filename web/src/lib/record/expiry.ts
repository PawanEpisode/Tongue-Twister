/** Recordings that are about to be deleted: how long is left and what "keep" asks the API for. Pure. */
const DAY_MS = 86_400_000

export function daysLeft(expiresAt: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - nowMs) / DAY_MS))
}

export const daysLeftLabel = (days: number): string =>
  days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`
