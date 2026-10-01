import { useState } from 'react'
import type { KeyboardEvent } from 'react'

/**
 * Which data point is being inspected. Pointer handlers set it from the mouse; `keyProps` make the whole
 * plot one tab stop where the arrow keys step through the points (so the data isn't hover-only).
 */
export function useActivePoint(count: number) {
  const [raw, setActive] = useState<number | null>(null)
  const active = raw !== null && raw < count ? raw : null

  const onKeyDown = (e: KeyboardEvent) => {
    if (!count) return
    const at = active ?? count - 1
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? Math.min(count - 1, at + 1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? Math.max(0, at - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? count - 1
              : null
    if (e.key === 'Escape') return setActive(null)
    if (next === null) return
    e.preventDefault()
    setActive(next)
  }
  const keyProps = {
    tabIndex: 0,
    onKeyDown,
    onFocus: () => setActive((a) => a ?? count - 1),
    onBlur: () => setActive(null),
  }
  return { active, setActive, keyProps }
}
