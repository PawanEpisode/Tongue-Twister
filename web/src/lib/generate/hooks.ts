import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '#/lib/auth'
import { useFlag } from '#/lib/flags'
import { track } from '#/lib/observability/analytics'
import { deleteMyTwister, generateTwister, listMyTwisters } from './api'
import type { GeneratedTwister } from './api'

export const MY_TWISTERS_KEY = ['my-twisters'] as const

export const useGenerateEnabled = () => useFlag('generate_twister')

export function useMyTwisters(enabled: boolean) {
  const { session } = useAuth()
  return useQuery({
    queryKey: [...MY_TWISTERS_KEY, session?.user.id ?? 'guest'],
    queryFn: listMyTwisters,
    enabled: enabled && !!session,
  })
}

export function useGenerate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: generateTwister,
    onSuccess: (_twister, body) => {
      track(
        'twister_generated',
        body.difficulty ? { difficulty: body.difficulty } : {},
      )
      void qc.invalidateQueries({ queryKey: MY_TWISTERS_KEY })
    },
  })
}

export function useDeleteMyTwister() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: deleteMyTwister,
    onSuccess: (_void, id) => {
      qc.setQueriesData<GeneratedTwister[]>(
        { queryKey: MY_TWISTERS_KEY },
        (list) => list?.filter((t) => t.id !== id),
      )
      void qc.invalidateQueries({ queryKey: MY_TWISTERS_KEY })
    },
  })
}
