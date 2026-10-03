import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '#/lib/api'
import type { Profile, ProfilePatch } from '#/lib/api'
import { applyPatch } from '#/lib/account/optimistic'

/**
 * Saves several profile fields in one PATCH. The `['me']` cache updates at once and is restored if the
 * server refuses, so the header avatar and the page never disagree. Errors are left to the caller to show.
 */
export function useUpdateProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: ProfilePatch) => api.updateProfile(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['me'] })
      const previous = qc.getQueryData<Profile>(['me'])
      if (previous) qc.setQueryData(['me'], applyPatch(previous, patch))
      return { previous }
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(['me'], ctx.previous)
    },
    onSuccess: (profile) => qc.setQueryData(['me'], profile),
  })
}
