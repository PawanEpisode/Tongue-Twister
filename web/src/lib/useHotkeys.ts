import { useEffect, useRef } from 'react'

type Handler = (e: KeyboardEvent) => void

/** Typing, or a widget (tablist) that owns the arrow keys itself. */
const ownsKeys = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) ||
    !!t.closest('[role="tablist"]'))

/** Keyboard layer keyed by `KeyboardEvent.key`. Never fires while typing, inside a tablist, or with Ctrl/Cmd/Alt held. */
export function useHotkeys(map: Record<string, Handler>, enabled = true) {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || ownsKeys(e.target)) return
      const handler = ref.current[e.key]
      if (!handler) return
      e.preventDefault()
      handler(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
