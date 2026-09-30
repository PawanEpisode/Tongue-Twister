import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import { useAuth } from './auth'

/** The signed-in profile (shares the header's `['me']` cache entry). */
export function useMe() {
  const { session } = useAuth()
  return useQuery({ queryKey: ['me'], queryFn: api.me, enabled: !!session })
}
