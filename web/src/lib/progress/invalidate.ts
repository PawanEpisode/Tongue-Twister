import type { QueryClient } from '@tanstack/react-query'

/** Everything an attempt, session or recording can change. One list so no call site forgets a surface. */
const PROGRESS_KEYS = [
  'me',
  'summary',
  'achievements',
  'stats',
  'activity',
  'twisters', // best score / mastery on cards and lists
  'favorites',
] as const

export function invalidateProgress(qc: QueryClient): Promise<unknown> {
  return Promise.all(
    PROGRESS_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })),
  )
}
