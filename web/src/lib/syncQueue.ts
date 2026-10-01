import type { GuestAttempt, GuestSyncPayload } from './api'
import { readJson, writeJson } from './storage'

/** What a guest did before signing up, kept on-device until the one-time import (decision D12). */
type Queue = { batchId: string; attempts: GuestAttempt[]; favorites: string[] }

const KEY = 'twister.guest.v1'
const MAX_ATTEMPTS = 50 // the API's per-batch cap; oldest are dropped first

const empty = (): Queue => ({
  batchId: crypto.randomUUID(),
  attempts: [],
  favorites: [],
})

const read = () => readJson(KEY, empty)
const write = (q: Queue) => writeJson(KEY, q)

/** Fired on this tab whenever the on-device favourites change, so lists and stars stay in step. */
export const GUEST_FAVORITES_EVENT = 'twister:guest-favorites'
const announceFavorites = () => {
  try {
    window.dispatchEvent(new Event(GUEST_FAVORITES_EVENT))
  } catch {
    /* no window (SSR): nothing is listening */
  }
}

export const guestQueue = {
  addAttempt(a: Omit<GuestAttempt, 'client_attempt_id' | 'created_at'>) {
    const q = read()
    q.attempts = [
      ...q.attempts,
      {
        ...a,
        client_attempt_id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
      },
    ].slice(-MAX_ATTEMPTS)
    write(q)
  },
  hasAttempts: () => read().attempts.length > 0,
  favorites: (): string[] => read().favorites,
  isFavorite: (slug: string) => read().favorites.includes(slug),
  /** Explicit target state (idempotent); the stored order is oldest first. */
  setFavorite(slug: string, on: boolean): boolean {
    const q = read()
    const rest = q.favorites.filter((s) => s !== slug)
    q.favorites = on ? [...rest, slug] : rest
    write(q)
    announceFavorites()
    return on
  },
  /** The payload to send, or null when there's nothing to import. The batch id is stable across retries. */
  payload(): GuestSyncPayload | null {
    const q = read()
    if (!q.attempts.length && !q.favorites.length) return null
    return {
      client_batch_id: q.batchId,
      attempts: q.attempts,
      favorites: q.favorites,
    }
  },
  /** After a successful import: forget it and mint a new batch id for whatever comes next. */
  clear: () => write(empty()),
}
