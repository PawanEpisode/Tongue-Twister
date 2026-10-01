import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { api } from './api'
import type { PracticeMode, SessionResult, SessionUpdate } from './api'
import { useAuth } from './auth'
import { invalidateProgress } from './progress/invalidate'
import { announceAchievements } from './progress/useAchievementToasts'

/**
 * Advisory server-side ledger for one practice run (streak, minutes, capped XP). Guests skip it,
 * and every failure is swallowed: practising must never depend on this call.
 *
 * `snapshot` supplies live stats so the session can be closed as "abandoned" if the user
 * leaves (unmount / mode switch / twister change) mid-run.
 */
export function usePracticeSession(
  slug: string,
  mode: PracticeMode,
  snapshot: () => SessionUpdate,
) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const id = useRef<Promise<string | null> | null>(null)
  const closed = useRef(false)
  const snap = useRef(snapshot)
  snap.current = snapshot

  const begin = useCallback(() => {
    if (!session || id.current) return
    closed.current = false
    id.current = api
      .startSession({
        client_session_id: crypto.randomUUID(),
        twister: slug,
        mode,
      })
      .then((r) => r.id)
      .catch(() => null)
  }, [session, slug, mode])

  const send = useCallback(
    async (
      patch: SessionUpdate,
      terminal: boolean,
    ): Promise<SessionResult | null> => {
      if (!id.current || closed.current) return null
      if (terminal) closed.current = true // set before awaiting so later calls are ignored
      const sessionId = await id.current
      if (!sessionId) return null
      try {
        const result = await api.updateSession(sessionId, patch)
        announceAchievements(result.achievements_unlocked)
        if (terminal) void invalidateProgress(qc)
        return result
      } catch {
        return null
      }
    },
    [qc],
  )

  const heartbeat = useCallback(() => send(snap.current(), false), [send])
  const finish = useCallback(
    (patch: SessionUpdate) =>
      send(
        {
          ...snap.current(),
          ...patch,
          status: 'completed',
          ended_reason: 'finished',
        },
        true,
      ),
    [send],
  )
  /** Forget a closed session so the next run gets a fresh one. */
  const reset = useCallback(() => {
    id.current = null
  }, [])

  useEffect(
    () => () => {
      void send(
        { ...snap.current(), status: 'abandoned', ended_reason: 'user' },
        true,
      )
    },
    [send],
  )

  // Stable identity: callers list it in effect dependencies.
  return useMemo(
    () => ({ begin, heartbeat, finish, reset }),
    [begin, heartbeat, finish, reset],
  )
}
