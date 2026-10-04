import { m, useReducedMotion, useScroll, useTransform } from 'motion/react'

/** A blurred colour orb that drifts slower than the page (at most 0.2x). Decorative. */
export function Orb({
  className,
  speed = 0.15,
}: {
  className: string
  speed?: number
}) {
  const reduce = useReducedMotion()
  const { scrollY } = useScroll()
  const y = useTransform(scrollY, (v) => v * speed)
  return (
    <m.div
      aria-hidden
      style={reduce ? undefined : { y }}
      className={`pointer-events-none absolute rounded-full blur-3xl ${className}`}
    />
  )
}
