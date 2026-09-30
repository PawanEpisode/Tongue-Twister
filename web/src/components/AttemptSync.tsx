import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { flushAttemptQueue } from '#/lib/attemptQueue'

/**
 * Renders nothing. Uploads attempts a signed-in user made offline: at start-up, on sign-in and
 * whenever the browser comes back online.
 */
export default function AttemptSync() {
  const { session } = useAuth()
  const qc = useQueryClient()
  const userId = session?.user.id

  useEffect(() => {
    if (!userId) return
    const flush = () =>
      void flushAttemptQueue(userId, api.syncAttempts).then((r) => {
        if (!r.uploaded) return
        void qc.invalidateQueries({ queryKey: ['me'] })
        void qc.invalidateQueries({ queryKey: ['twister'] })
        void qc.invalidateQueries({ queryKey: ['history'] })
      })
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [userId, qc])

  return null
}
