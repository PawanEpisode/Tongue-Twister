import { DEMO_TWISTERS } from '#/content/demo'

/** The one demo attempt, kept for this tab only so signing up in the same visit can claim it. */
export type StoredDemo = {
  slug: string
  transcript: string
  duration_ms: number
  score: number
  created_at: string
  client_attempt_id: string
}
const KEY = 'twister.demo.v1'

export const demoStore = {
  get(): StoredDemo | null {
    try {
      const raw = window.sessionStorage.getItem(KEY)
      if (!raw) return null
      const d = JSON.parse(raw) as StoredDemo
      return DEMO_TWISTERS.some((t) => t.slug === d.slug) && d.transcript
        ? d
        : null
    } catch {
      return null
    }
  },
  set(d: Omit<StoredDemo, 'client_attempt_id'>) {
    try {
      window.sessionStorage.setItem(
        KEY,
        JSON.stringify({ ...d, client_attempt_id: crypto.randomUUID() }),
      )
    } catch {
      /* storage blocked: the score simply cannot be carried through sign-up */
    }
  },
  clear() {
    try {
      window.sessionStorage.removeItem(KEY)
    } catch {
      /* nothing to clear */
    }
  },
}
