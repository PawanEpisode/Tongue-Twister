import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

const STEP = 0.05
const WHEEL_SENSITIVITY = 0.01 // trackpad pinch arrives as ctrl+wheel

const snap = (n: number) => Math.round(n / STEP) * STEP

/** New scale after a pinch: the start scale times how much the fingers spread, snapped and clamped. */
export const pinchScale = (
  startScale: number,
  startDistance: number,
  distance: number,
  [min, max]: readonly [number, number],
) =>
  +Math.min(
    max,
    Math.max(min, snap(startScale * (distance / startDistance))),
  ).toFixed(2)

/**
 * Pinch (touch) or ctrl+wheel (trackpad) to zoom text. The element needs `touch-action: pan-y`
 * so the browser leaves the two-finger gesture to us while still scrolling vertically.
 */
export function usePinchZoom(
  ref: RefObject<HTMLElement | null>,
  scale: number,
  range: readonly [number, number],
  onChange: (next: number) => void,
) {
  const latest = useRef({ scale, range, onChange })
  latest.current = { scale, range, onChange }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const pointers = new Map<number, { x: number; y: number }>()
    let start: { distance: number; scale: number } | null = null
    const distance = () => {
      const [a, b] = [...pointers.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    const emit = (next: number) => {
      if (next !== latest.current.scale) latest.current.onChange(next)
    }

    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2)
        start = { distance: distance() || 1, scale: latest.current.scale }
    }
    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 2 && start)
        emit(
          pinchScale(
            start.scale,
            start.distance,
            distance(),
            latest.current.range,
          ),
        )
    }
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) start = null
    }
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault() // otherwise the whole page zooms
      const { scale: s, range: r } = latest.current
      emit(pinchScale(s, 1, 1 - e.deltaY * WHEEL_SENSITIVITY, r))
    }

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [ref])
}
