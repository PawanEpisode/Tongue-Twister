import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'

/** The signed-in progress summary (mastered, streak, XP, unseen unlocks). Disabled for guests. */
export function useSummary() {
  const { session } = useAuth()
  const userId = session?.user.id
  return useQuery({
    queryKey: ['summary', userId],
    queryFn: api.summary,
    enabled: !!userId,
  })
}
