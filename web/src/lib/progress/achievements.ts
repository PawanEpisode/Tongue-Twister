import type { UnlockedAchievement } from '../api'

/**
 * The toast queue, as pure state. Unlocks reach the web twice — inline in an attempt response and later
 * as `unseen_achievements` in the summary — and each achievement must be celebrated once, so every code
 * is remembered for the life of the page (`announced`) and never queued again.
 */
export type ToastState = {
  queue: readonly UnlockedAchievement[]
  /** Codes that were ever queued in this page session. */
  announced: ReadonlySet<string>
}

export const emptyToasts = (): ToastState => ({
  queue: [],
  announced: new Set(),
})

/** Adds unlocks not announced before; the order of arrival is kept. Returns `state` itself when nothing is new. */
export function enqueue(
  state: ToastState,
  incoming: readonly UnlockedAchievement[],
): ToastState {
  const fresh: UnlockedAchievement[] = []
  const announced = new Set(state.announced)
  for (const a of incoming) {
    if (announced.has(a.code)) continue
    announced.add(a.code)
    fresh.push(a)
  }
  return fresh.length ? { queue: [...state.queue, ...fresh], announced } : state
}

/** Drops one toast (dismissed or timed out). Its code stays in `announced`. */
export function dismiss(state: ToastState, code: string): ToastState {
  return state.queue.some((a) => a.code === code)
    ? { ...state, queue: state.queue.filter((a) => a.code !== code) }
    : state
}

/**
 * Collects codes and flushes them in one `POST /me/achievements/seen/` after a short quiet period, so a
 * burst of unlocks costs one request. A failed flush puts the codes back for the next one.
 */
export function createSeenBatcher(
  flush: (codes: string[]) => Promise<unknown>,
  delayMs = 1_000,
) {
  let pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const run = async () => {
    timer = undefined
    if (!pending.size) return
    const codes = [...pending]
    pending = new Set()
    try {
      await flush(codes)
    } catch {
      codes.forEach((c) => pending.add(c)) // retried with the next batch
    }
  }
  return {
    add(code: string) {
      pending.add(code)
      clearTimeout(timer)
      timer = setTimeout(() => void run(), delayMs)
    },
    /** Send what is waiting right now (e.g. when the page is hidden). */
    flushNow() {
      clearTimeout(timer)
      return run()
    },
  }
}
