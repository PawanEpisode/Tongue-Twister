import { useEffect } from 'react'
import { track } from './analytics'
import type { EventProps } from './events'

/** Fires `practice_started` each time `active` turns true (one take = one event), never while it stays true. */
export function usePracticeStarted(
  mode: EventProps['practice_started']['mode'],
  active: boolean,
): void {
  useEffect(() => {
    if (active) track('practice_started', { mode })
  }, [mode, active])
}
