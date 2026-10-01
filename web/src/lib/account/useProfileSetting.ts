import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '#/lib/api'
import type { Profile, ProfilePatch } from '#/lib/api'
import { applyPatch } from './optimistic'
import type { SaveStatus } from './optimistic'

/**
 * One saved profile setting: the switch flips at once, the PATCH follows, and a failure puts the old
 * value back. The `['me']` cache is the single source, so the header and the page never disagree.
 */
export function useProfileSetting<TKey extends keyof ProfilePatch>(key: TKey) {
  const qc = useQueryClient()
  const [failed, setFailed] = useState(false)

  const mutation = useMutation({
    mutationFn: (value: NonNullable<ProfilePatch[TKey]>) =>
      api.updateProfile({ [key]: value }),
    onMutate: async (value) => {
      await qc.cancelQueries({ queryKey: ['me'] })
      const previous = qc.getQueryData<Profile>(['me'])
      if (previous)
        qc.setQueryData(['me'], applyPatch(previous, { [key]: value }))
      setFailed(false)
      return { previous }
    },
    onError: (_err, _value, ctx) => {
      if (ctx?.previous) qc.setQueryData(['me'], ctx.previous)
      setFailed(true)
    },
    onSuccess: (profile) => qc.setQueryData(['me'], profile),
    onSettled: () => {
      // Streak days and "today" depend on these settings, so the summary is stale too.
      void qc.invalidateQueries({ queryKey: ['summary'] })
      void qc.invalidateQueries({ queryKey: ['weekly-board'] })
    },
  })

  const status: SaveStatus = mutation.isPending
    ? 'saving'
    : failed
      ? 'failed'
      : mutation.isSuccess
        ? 'saved'
        : 'idle'
  return { save: mutation.mutate, status }
}
