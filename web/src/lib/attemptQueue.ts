import { ApiError } from './api'
import type { AttemptSyncResult, SubmitAttemptBody } from './api'
import { readJson, writeJson } from './storage'

/**
 * Attempts a signed-in user made while the API was unreachable. They are replayed in order through
 * POST /attempts/sync/ (≤ 50 per request); the server de-duplicates on `client_attempt_id`, so a
 * retry after a lost response is harmless. Each item remembers whose it is: a different account
 * signing in on the same browser must never upload it.
 */
export type QueuedAttempt = SubmitAttemptBody & {
  user_id: string
  occurred_at: string
}
type Store = { items: QueuedAttempt[] }

const KEY = 'twister.attempts.v1'
export const BATCH_SIZE = 50
export const MAX_QUEUED = 200 // storage stays small; the oldest are dropped first

const read = () => readJson<Store>(KEY, () => ({ items: [] }))
const write = (s: Store) => writeJson(KEY, s)

export const attemptQueue = {
  add(userId: string, body: SubmitAttemptBody, now = new Date()) {
    const { items } = read()
    if (items.some((i) => i.client_attempt_id === body.client_attempt_id))
      return
    write({
      items: [
        ...items,
        { ...body, user_id: userId, occurred_at: now.toISOString() },
      ].slice(-MAX_QUEUED),
    })
  },
  pending: (userId: string): QueuedAttempt[] =>
    read()
      .items.filter((i) => i.user_id === userId)
      .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
  remove(ids: ReadonlySet<string>) {
    write({
      items: read().items.filter((i) => !ids.has(i.client_attempt_id)),
    })
  },
}

/** Worth retrying later: offline, throttled, timed out, server trouble, or signed out. */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true // fetch itself failed
  return err.status >= 500 || [401, 403, 408, 425, 429].includes(err.status)
}

type Sender = (attempts: SubmitAttemptBody[]) => Promise<AttemptSyncResult>
let inflight: Promise<FlushResult> | null = null

export type FlushResult = {
  uploaded: number
  profile: AttemptSyncResult['profile'] | null
}

/**
 * Uploads everything queued for `userId`. Never throws: whatever could not be sent stays queued.
 * Concurrent calls share one run so a `online` event and a sign-in cannot double-send.
 */
export function flushAttemptQueue(
  userId: string,
  send: Sender,
): Promise<FlushResult> {
  inflight ??= run(userId, send).finally(() => {
    inflight = null
  })
  return inflight
}

async function run(userId: string, send: Sender): Promise<FlushResult> {
  let uploaded = 0
  let profile: FlushResult['profile'] = null
  for (;;) {
    const batch = attemptQueue.pending(userId).slice(0, BATCH_SIZE)
    if (!batch.length) break
    try {
      const res = await send(batch.map(({ user_id: _user, ...body }) => body))
      profile = res.profile
      uploaded += res.counts.created
      // Every reply is final: created, duplicate, or rejected (it would be rejected again).
      attemptQueue.remove(new Set(batch.map((b) => b.client_attempt_id)))
    } catch (err) {
      if (isTransient(err)) break
      // A batch the server calls malformed would fail forever; drop it rather than block the queue.
      attemptQueue.remove(new Set(batch.map((b) => b.client_attempt_id)))
    }
  }
  return { uploaded, profile }
}
