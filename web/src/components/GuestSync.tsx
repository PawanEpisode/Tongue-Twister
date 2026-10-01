import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { invalidateProgress } from '#/lib/progress/invalidate'
import { guestQueue } from '#/lib/syncQueue'

/**
 * Renders nothing. When a visitor signs in, imports what they did as a guest (attempts, favourites)
 * once. Safe to retry: the batch id is stable until the server confirms.
 */
export default function GuestSync() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const userId = session?.user.id

  useEffect(() => {
    if (!userId) return
    const payload = guestQueue.payload()
    if (!payload) return
    let cancelled = false
    api
      .syncGuest(payload)
      .then(() => {
        guestQueue.clear()
        if (cancelled) return
        void invalidateProgress(qc)
        void qc.invalidateQueries({ queryKey: ['twister'] })
        void qc.invalidateQueries({ queryKey: ['history'] })
      })
      .catch(() => undefined) // keep the queue; the next sign-in/visit retries with the same batch id
    return () => {
      cancelled = true
    }
  }, [userId, qc])

  return null
}
