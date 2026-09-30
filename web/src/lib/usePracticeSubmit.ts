import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { api } from './api'
import type { AttemptResult, AttemptKind, Segment } from './api'
import { useAuth } from './auth'
import { attemptQueue, isTransient } from './attemptQueue'

export type PracticeTake = {
  twister: string
  kind: Extract<AttemptKind, 'train' | 'drill'>
  segment: Segment
  transcript: string
  durationMs: number
  longPauseMs?: number
  confidence?: number | null
}

/**
 * Saves a Train / Drill take. Best effort by design: the learner already has their result on
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
        segment: take.segment,
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
        void qc.invalidateQueries({ queryKey: ['me'] })
        void qc.invalidateQueries({ queryKey: ['weak-words'] })
        return r
      } catch (err) {
        if (isTransient(err)) attemptQueue.add(userId, body)
        return null
      }
    },
    [userId, qc],
  )
}
