import { useCallback, useEffect, useRef, useState } from 'react'

/** Focus mode: fullscreen a single element; state follows Esc / browser UI too. */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const sync = () =>
      setActive(document.fullscreenElement === ref.current && !!ref.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggle = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void ref.current?.requestFullscreen?.().catch(() => undefined)
  }, [])

  return {
    ref,
    active,
    toggle,
    supported: typeof document !== 'undefined' && document.fullscreenEnabled,
  }
}
