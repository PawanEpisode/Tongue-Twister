import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { api } from '../api'
import type { UnlockedAchievement } from '../api'
import {
  createSeenBatcher,
  dismiss,
  emptyToasts,
  enqueue,
} from './achievements'
import type { ToastState } from './achievements'
import { useSummary } from './useSummary'

/** The one toast queue for the page: attempt responses push into it, the summary tops it up. */
let state: ToastState = emptyToasts()
const listeners = new Set<() => void>()
const update = (next: ToastState) => {
  if (next === state) return
  state = next
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const EMPTY: readonly UnlockedAchievement[] = []

/** Call with `achievements_unlocked` from any attempt or session response. Safe with `undefined`. */
export function announceAchievements(
  unlocked: readonly UnlockedAchievement[] | undefined,
) {
  if (unlocked?.length) update(enqueue(state, unlocked))
}

/** Test seam: start from a clean queue. */
export function resetAchievementToasts() {
  update(emptyToasts())
}

/** The toast to show now, how many wait behind it, and `close` (which also marks it seen). */
export function useAchievementToasts() {
  const qc = useQueryClient()
  const { data: summary } = useSummary()
  const queue = useSyncExternalStore(
    subscribe,
    () => state.queue,
    () => EMPTY,
  )

  const seen = useMemo(
    () =>
      createSeenBatcher(async (codes) => {
        await api.markAchievementsSeen(codes)
        void qc.invalidateQueries({ queryKey: ['summary'] })
        void qc.invalidateQueries({ queryKey: ['achievements'] })
      }),
    [qc],
  )

  // Unlocks that happened elsewhere (another device, a saved recording) arrive via the summary.
  useEffect(() => {
    announceAchievements(summary?.unseen_achievements)
  }, [summary?.unseen_achievements])

  const close = useCallback(
    (code: string) => {
      update(dismiss(state, code))
      seen.add(code)
    },
    [seen],
  )

  return {
    current: queue[0] ?? null,
    waiting: Math.max(0, queue.length - 1),
    close,
  }
}
