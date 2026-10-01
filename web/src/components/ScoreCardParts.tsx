import { animate, m, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useId } from 'react'
import type { ReactNode } from 'react'

const RADIUS = 70
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * The score ring shared by the result screen (animated) and the public score card (static, so the
 * server-rendered page already shows the number). `children` overlay the ring.
 */
export function ScoreRing({
  score,
  animated = false,
  children,
}: {
  score: number
  animated?: boolean
  children?: ReactNode
}) {
  const gradient = useId()
  const mv = useMotionValue(animated ? 0 : score)
  const shown = useTransform(mv, (v) => Math.round(v))
  useEffect(() => {
    if (!animated) return
    const controls = animate(mv, score, { duration: 1.4, ease: 'easeOut' })
    return () => controls.stop()
  }, [animated, score, mv])

  const offset = CIRCUMFERENCE * (1 - score / 100)
  return (
    <div className="relative mx-auto h-44 w-44">
      <svg
        viewBox="0 0 160 160"
        className="h-full w-full -rotate-90"
        aria-hidden
      >
        <circle
          cx="80"
          cy="80"
          r={RADIUS}
          stroke="var(--border)"
          strokeWidth="12"
          fill="none"
        />
        <m.circle
          cx="80"
          cy="80"
          r={RADIUS}
          stroke={`url(#${gradient})`}
          strokeWidth="12"
          strokeLinecap="round"
          fill="none"
          strokeDasharray={CIRCUMFERENCE}
          initial={{ strokeDashoffset: animated ? CIRCUMFERENCE : offset }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: animated ? 1.4 : 0, ease: 'easeOut' }}
        />
        <defs>
          <linearGradient id={gradient}>
            <stop offset="0" stopColor="var(--brand)" />
            <stop offset="1" stopColor="var(--pink)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div>
          <m.span className="font-display text-5xl font-extrabold">
            {shown}
          </m.span>
          <div className="text-xs text-muted-foreground">/ 100</div>
        </div>
      </div>
      {children}
    </div>
  )
}

export const StatTile = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-xl bg-background/60 p-3">
    <div className="text-xs text-muted-foreground">{k}</div>
    <div className="font-semibold">{v}</div>
  </div>
)
