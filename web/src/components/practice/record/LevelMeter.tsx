import { useEffect, useRef } from 'react'

/** Live microphone level. Updates the bar's style directly (10×/s) so React never re-renders for it. */
export default function LevelMeter({
  level,
  label = 'Microphone level',
}: {
  level: () => number
  label?: string
}) {
  const bar = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const id = setInterval(() => {
      const v = Math.min(1, level() * 2.5)
      if (bar.current) bar.current.style.width = `${Math.round(v * 100)}%`
      if (box.current)
        box.current.setAttribute('aria-valuenow', String(Math.round(v * 100)))
    }, 100)
    return () => clearInterval(id)
  }, [level])
  return (
    <div
      ref={box}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={0}
      className="h-2 w-full overflow-hidden rounded-full bg-card"
    >
      <div
        ref={bar}
        className="h-full w-0 rounded-full bg-lime transition-[width] duration-100"
      />
    </div>
  )
}
