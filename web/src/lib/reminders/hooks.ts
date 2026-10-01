import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { SaveStatus } from '#/lib/account/optimistic'
import { useAuth } from '#/lib/auth'
import { useFlag } from '#/lib/flags'
import { getReminders, putReminders } from './api'
import type { ReminderPrefs } from './api'

export const useRemindersEnabled = () => useFlag('reminders')

export function useReminders(enabled: boolean) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['reminders', session?.user.id ?? 'guest'],
    queryFn: getReminders,
    enabled: enabled && !!session,
  })
}

/** Optimistic save: the control moves at once; a failure puts the old value back. */
export function useSaveReminders() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const key = ['reminders', session?.user.id ?? 'guest']
  const [failed, setFailed] = useState(false)
  const m = useMutation({
    mutationFn: putReminders,
    onMutate: async (next: ReminderPrefs) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<ReminderPrefs>(key)
      qc.setQueryData(key, next)
      setFailed(false)
      return { previous }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
      setFailed(true)
    },
    onSuccess: (saved) => qc.setQueryData(key, saved),
  })
  const status: SaveStatus = m.isPending
    ? 'saving'
    : failed
      ? 'failed'
      : m.isSuccess
        ? 'saved'
        : 'idle'
  return { save: m.mutate, status }
}
