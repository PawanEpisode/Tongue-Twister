import { readJson, writeJson } from '../storage'

/** Mirrors the API's `RANDOM_EXCLUDE_MAX`: more excluded slugs than this is a 400. */
export const RANDOM_EXCLUDE_MAX = 20
/** How many recent Random picks we avoid repeating (spec §7: the last 5). */
export const RECENT_KEEP = 5

/** `slug` goes to the front; duplicates collapse; the list never outgrows `cap` (itself capped by the API limit). */
export function pushRecent(
  list: readonly string[],
  slug: string,
  cap = RECENT_KEEP,
): string[] {
  const limit = Math.min(Math.max(cap, 1), RANDOM_EXCLUDE_MAX)
  return [slug, ...list.filter((s) => s !== slug)].slice(0, limit)
}

const KEY = 'twister.recent.v1'
type Stored = { slugs: string[] }

/** Twisters Random showed lately, per browser, newest first. */
export const recentTwisters = {
  get: (): string[] => {
    const { slugs } = readJson<Stored>(KEY, () => ({ slugs: [] }))
    return Array.isArray(slugs)
      ? slugs.filter((s): s is string => typeof s === 'string')
      : []
  },
  add(slug: string) {
    writeJson(KEY, { slugs: pushRecent(this.get(), slug) })
  },
}
