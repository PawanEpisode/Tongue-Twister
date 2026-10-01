import type { BrowseSort, BrowseStatus } from '../api'

export const BROWSE_STATUSES: readonly BrowseStatus[] = [
  'mastered',
  'in_progress',
  'not_started',
  'favorites',
]
export const BROWSE_SORTS: readonly BrowseSort[] = [
  'recommended',
  'newest',
  'shortest',
  'longest',
  'hardest',
  'easiest',
  'best_desc',
  'best_asc',
]
export const DEFAULT_SORT: BrowseSort = 'recommended'

export const STATUS_LABELS: Record<BrowseStatus, string> = {
  mastered: 'Mastered',
  in_progress: 'In progress',
  not_started: 'Not started',
  favorites: 'Favourites',
}
export const SORT_LABELS: Record<BrowseSort, string> = {
  recommended: 'Recommended',
  newest: 'Newest',
  shortest: 'Shortest first',
  longest: 'Longest first',
  hardest: 'Hardest first',
  easiest: 'Easiest first',
  best_desc: 'Best score: high to low',
  best_asc: 'Best score: low to high',
}
/** Sorts that only mean something with a score history. */
export const SIGNED_IN_SORTS: readonly BrowseSort[] = ['best_desc', 'best_asc']

/** Anything unrecognised (a stale link, a typo) is dropped without an error page. */
export const parseStatus = (v: unknown): BrowseStatus | undefined =>
  BROWSE_STATUSES.find((s) => s === v)

export const parseSort = (v: unknown): BrowseSort | undefined => {
  const sort = BROWSE_SORTS.find((s) => s === v)
  return sort === DEFAULT_SORT ? undefined : sort // the default stays out of the URL
}

/**
 * What to send to the API. Guests can't filter by progress (the API answers 400), so a `status` in a
 * shared link is ignored for them rather than breaking the page.
 */
export function toApiParams(
  search: { status?: BrowseStatus; sort?: BrowseSort },
  signedIn: boolean,
): { status?: BrowseStatus; sort?: BrowseSort } {
  return {
    ...(signedIn && search.status && { status: search.status }),
    ...(search.sort && search.sort !== DEFAULT_SORT && { sort: search.sort }),
  }
}
