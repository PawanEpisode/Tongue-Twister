import { useEffect, useRef, useState } from 'react'

/** The rendered width of a chart's container, so SVG text stays the same size at any screen width. */
export function useChartWidth(initial = 640) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(Math.round(el.getBoundingClientRect().width) || initial)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0)
      if (w) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [initial])
  return { ref, width }
}
