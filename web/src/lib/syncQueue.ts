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
  isFavorite: (slug: string) => read().favorites.includes(slug),
  toggleFavorite(slug: string): boolean {
    const q = read()
    const on = !q.favorites.includes(slug)
    q.favorites = on
      ? [...q.favorites, slug]
      : q.favorites.filter((s) => s !== slug)
    write(q)
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
