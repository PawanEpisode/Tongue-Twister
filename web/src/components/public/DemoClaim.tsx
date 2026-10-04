import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { invalidateProgress } from '#/lib/progress/invalidate'
import { track } from '#/lib/observability/analytics'
import { scoreBand } from '#/lib/observability/events'
import { demoStore } from '#/lib/public/demoStore'
import {
  markAttributionSent,
  pendingAttribution,
} from '#/lib/public/attribution'

/**
 * Renders nothing. Right after sign-in it (1) claims the landing-page demo score, if this tab has one,
 * as the account's first result (the server re-scores it; it never trusts the number), and (2) records
 * how the visitor arrived, once. Both are best effort: a failure never blocks the app.
 */
export default function DemoClaim() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const userId = session?.user.id

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const demo = demoStore.get()
    if (demo) {
      void api
        .syncGuest({
          client_batch_id: crypto.randomUUID(),
          kind: 'demo_claim',
          favorites: [],
          attempts: [
            {
              client_attempt_id: demo.client_attempt_id,
              twister: demo.slug,
              transcript: demo.transcript,
              duration_ms: demo.duration_ms,
              created_at: demo.created_at,
            },
          ],
        })
        .then(() => {
          demoStore.clear()
          track('demo_claimed', { score_band: scoreBand(demo.score) })
          if (!cancelled) void invalidateProgress(qc)
        })
        .catch(() => undefined)
    }
    const attr = pendingAttribution()
    if (attr)
      void api
        .attribution(attr)
        .then(markAttributionSent)
        .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [userId, qc])

  return null
}
