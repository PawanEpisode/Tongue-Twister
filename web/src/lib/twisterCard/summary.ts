/** Header counts for the library: how many exist, and how many have been tried. */

export type LibrarySummary = {
  total: number
  practised: number
  waiting: number
}

export function librarySummary(
  items: { attempts_count?: number | null }[],
): LibrarySummary {
  const practised = items.filter(
    (item) => (item.attempts_count ?? 0) > 0,
  ).length
  return {
    total: items.length,
    practised,
    waiting: items.length - practised,
  }
}

export function libraryHeadline(summary: LibrarySummary): string {
  const twisters =
    summary.total === 1 ? '1 twister' : `${summary.total} twisters`
  return `${twisters} · ${summary.practised} practised · ${summary.waiting} waiting for a first try`
}
