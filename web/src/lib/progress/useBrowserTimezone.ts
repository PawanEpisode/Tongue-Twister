import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '../api'
import { useMe } from '../useMe'
import { browserTimeZone, timezoneToSync } from './timezone'

const KEY = 'twister.tz.synced.v1'

const wasSynced = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}
const markSynced = (zone: string) => {
  try {
    window.localStorage.setItem(KEY, zone)
  } catch {
    /* storage blocked: we'll try again next visit, harmlessly */
  }
}

/** Silent, once per device (see `timezoneToSync`). A failure is retried on the next visit. */
export function useBrowserTimezone() {
  const { data: me } = useMe()
  const qc = useQueryClient()
  const profileZone = me?.timezone

  useEffect(() => {
    const zone = timezoneToSync(profileZone, browserTimeZone(), wasSynced())
    if (!zone) return
    let cancelled = false
    api
      .setTimezone(zone)
      .then(() => {
        markSynced(zone)
        if (cancelled) return
        void qc.invalidateQueries({ queryKey: ['me'] })
        void qc.invalidateQueries({ queryKey: ['summary'] })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [profileZone, qc])
}
