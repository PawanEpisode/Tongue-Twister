import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '#/lib/api'
import type { DeletionRequest, Profile } from '#/lib/api'
import { useMe } from '#/lib/useMe'
import { deletionState } from './deletion'

/** Whether the signed-in account is waiting out its grace period (D21), and until when. */
export function useDeletionState() {
  return deletionState(useMe().data)
}

const withScheduledFor = (
  me: Profile | undefined,
  scheduledFor: string | null,
): Profile | undefined => me && { ...me, deletion_scheduled_for: scheduledFor }

export function useRequestDeletion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.requestDeletion,
    onSuccess: (r: DeletionRequest) => {
      qc.setQueryData<Profile | undefined>(['me'], (me) =>
        withScheduledFor(me, r.deletion_scheduled_for),
      )
      void qc.invalidateQueries({ queryKey: ['summary'] })
    },
  })
}

export function useCancelDeletion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: api.cancelDeletion,
    onSuccess: () => {
      qc.setQueryData<Profile | undefined>(['me'], (me) =>
        withScheduledFor(me, null),
      )
      // The profile is back on the boards and reminders resume: refetch everything that depends on it.
      void qc.invalidateQueries()
    },
  })
}
