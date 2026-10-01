import { useSyncExternalStore } from 'react'

/** The in-app analytics opt-out (D28). Stored on this device only; never sent anywhere. */
export const OPT_OUT_KEY = 'twister.analytics.optout.v1'

const listeners = new Set<() => void>()

export function isOptedOut(): boolean {
  try {
    return window.localStorage.getItem(OPT_OUT_KEY) === '1'
  } catch {
    return false
  }
}

export function setOptedOut(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(OPT_OUT_KEY, '1')
    else window.localStorage.removeItem(OPT_OUT_KEY)
  } catch {
    /* blocked storage: the choice lasts only until reload, and analytics stays off in this tab below */
    memoryOptOut = value
  }
  listeners.forEach((l) => l())
}
let memoryOptOut = false

/** Browser Do-Not-Track, in every spelling the browsers use. */
export function doNotTrack(): boolean {
  if (typeof navigator === 'undefined') return false
  const w = window as unknown as { doNotTrack?: string }
  const v = navigator.doNotTrack ?? w.doNotTrack
  return v === '1' || v === 'yes'
}

/** True when nothing may be sent: DNT is on or the user opted out. */
export const analyticsBlocked = (): boolean =>
  doNotTrack() || memoryOptOut || isOptedOut()

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', cb)
  }
}

/** Reactive opt-out state for the Privacy switch. `dnt` means the browser setting wins and the switch is moot. */
export function useAnalyticsConsent(): { optedOut: boolean; dnt: boolean } {
  const optedOut = useSyncExternalStore(
    subscribe,
    () => isOptedOut() || memoryOptOut,
    () => false,
  )
  const dnt = useSyncExternalStore(subscribe, doNotTrack, () => false)
  return { optedOut, dnt }
}
