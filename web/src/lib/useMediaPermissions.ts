import { useCallback, useEffect, useState } from 'react'

export type MediaKind = 'microphone' | 'camera'
export type PermissionState =
  | 'unknown'
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'in_use'
  | 'error'

const MAX_DENIALS = 2 // after two refusals we stop asking and show settings help (PRD 01 §7)
const denialKey = (kind: MediaKind) => `twister.perm.denied.${kind}`

/** getUserMedia error → user-facing state. */
export function stateFromError(name: string): PermissionState {
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'denied'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'unavailable'
    case 'NotReadableError':
    case 'AbortError':
      return 'in_use'
    default:
      return 'error'
  }
}

function denials(kind: MediaKind): number {
  try {
    return Number(window.sessionStorage.getItem(denialKey(kind)) ?? 0)
  } catch {
    return 0
  }
}
function countDenial(kind: MediaKind) {
  try {
    window.sessionStorage.setItem(denialKey(kind), String(denials(kind) + 1))
  } catch {
    /* storage blocked: we simply can't rate-limit prompts this visit */
  }
}

/**
 * Permission state for one device kind. Never prompts by itself — `requestAccess()` is called from a click.
 * Safari doesn't expose mic/camera state, so it stays 'unknown' until the first request.
 */
export function useMediaPermissions(kind: MediaKind) {
  const [state, setState] = useState<PermissionState>('unknown')

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) return setState('unavailable')
    let status: PermissionStatus | undefined
    const sync = () =>
      status && setState(status.state === 'prompt' ? 'prompt' : status.state)
    navigator.permissions
      ?.query({ name: kind })
      .then((s) => {
        status = s
        s.onchange = sync
        sync()
      })
      .catch(() => undefined) // unsupported name (Safari/Firefox camera): stay 'unknown'
    return () => {
      if (status) status.onchange = null
    }
  }, [kind])

  /** Resolves true when the device can be used. Holds the stream only long enough to prove access. */
  const requestAccess = useCallback(async (): Promise<boolean> => {
    if (denials(kind) >= MAX_DENIALS) {
      setState('denied')
      return false
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'microphone' ? { audio: true } : { video: true },
      )
      stream.getTracks().forEach((t) => t.stop())
      setState('granted')
      return true
    } catch (err) {
      const next = stateFromError(err instanceof DOMException ? err.name : '')
      if (next === 'denied') countDenial(kind)
      setState(next)
      return false
    }
  }, [kind])

  return { state, requestAccess }
}
