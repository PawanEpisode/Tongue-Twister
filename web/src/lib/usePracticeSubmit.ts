import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { api } from './api'
import type { AttemptResult, AttemptKind, Segment } from './api'
import { useAuth } from './auth'
import { attemptQueue, isTransient } from './attemptQueue'
import { track } from './observability/analytics'
import { scoreBand } from './observability/events'
import { invalidateProgress } from './progress/invalidate'
import { announceAchievements } from './progress/useAchievementToasts'
import { invalidateWordQueues } from './wordQueues'

export type PracticeTake = {
  twister: string
  kind: Extract<AttemptKind, 'train' | 'drill' | 'record'>
  /** Train and Drill score only the practised words; a whole recorded take has none. */
  segment?: Segment
  transcript: string
  durationMs: number
  longPauseMs?: number
  confidence?: number | null
}

/**
 * Saves a Train / Drill / Record take. Best effort by design: the learner already has their result on
 * screen, so a failure never interrupts practice. Offline or throttled takes are queued and replayed;
 * guests keep nothing (their history is Test attempts only). Resolves to the saved result, or null.
 */
export function usePracticeSubmit() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const userId = session?.user.id

  return useCallback(
    async (take: PracticeTake): Promise<AttemptResult | null> => {
      if (!userId) return null
      const body = {
        client_attempt_id: crypto.randomUUID(),
        twister: take.twister,
        kind: take.kind,
        ...(take.segment && { segment: take.segment }),
        transcript: take.transcript,
        duration_ms: Math.max(300, Math.round(take.durationMs)),
        long_pause_ms: Math.min(
          Math.round(take.longPauseMs ?? 0),
          Math.max(300, Math.round(take.durationMs)),
        ),
        stt: {
          engine: 'text_layer' as const,
          confidence: take.confidence ?? null,
        },
      }
      try {
        const r = await api.submitAttempt(body)
        if (r.low_confidence) return null
        track('attempt_completed', {
          kind: take.kind,
          score_band: scoreBand(r.score),
        })
        announceAchievements(r.achievements_unlocked)
        void invalidateProgress(qc)
        void invalidateWordQueues(qc)
        return r
      } catch (err) {
        if (isTransient(err)) attemptQueue.add(userId, body)
        return null
      }
    },
    [userId, qc],
  )
}
