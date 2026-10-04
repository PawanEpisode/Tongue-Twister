import {
  m,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react'
import type { MotionValue } from 'motion/react'
import { Check } from 'lucide-react'
import { useRef } from 'react'
import { MODES } from '#/content/landing'
import { Reveal } from '#/components/public/motion/Reveal'
import { cn } from '#/lib/utils'
import { FrameSay } from './Frames'
import { useMediaQuery } from './useMediaQuery'

const TONE = {
  violet: 'bg-[color-mix(in_srgb,var(--brand)_14%,var(--card))]',
  lime: 'bg-[color-mix(in_srgb,var(--lime)_14%,var(--card))]',
  pink: 'bg-[color-mix(in_srgb,var(--pink)_14%,var(--card))]',
} as const

function Card({
  mode,
  i,
  progress,
  sticky,
}: {
  mode: (typeof MODES)[number]
  i: number
  progress: MotionValue<number>
  sticky: boolean
}) {
  // The card is covered by the next one: it eases to 0.96 and dims a little (scroll-linked).
  const start = i / MODES.length
  const end = Math.min(1, (i + 1) / MODES.length)
  const raw = useTransform(progress, [start, end], [1, 0.96])
  const scale = useSpring(raw, { stiffness: 120, damping: 20 })
  const dim = useTransform(progress, [start, end], [1, 0.92])
  return (
    <m.div
      style={
        sticky
          ? { top: `calc(5rem + ${i * 12}px)`, scale, opacity: dim }
          : undefined
      }
      className={cn(
        'rounded-3xl border border-border p-6 sm:p-10',
        TONE[mode.tone],
        sticky && 'sticky mb-8',
      )}
    >
      <div className="grid items-center gap-8 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Mode {i + 1}</p>
          <h3 className="mt-1 text-3xl font-extrabold">{mode.title}</h3>
          <p className="mt-2 text-lg text-muted-foreground">{mode.line}</p>
          <ul className="mt-5 space-y-2.5">
            {mode.points.map((p) => (
              <li key={p} className="flex gap-2.5 text-sm">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-lime"
                  aria-hidden
                />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <FrameSay
          lit={mode.key === 'read' ? 4 : mode.key === 'speak' ? 7 : 8}
        />
      </div>
    </m.div>
  )
}

export default function Modes() {
  const ref = useRef<HTMLDivElement>(null)
  const wide = useMediaQuery('(min-width: 768px)')
  const reduce = useReducedMotion()
  const sticky = wide && !reduce
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end end'],
  })
  return (
    <section
      id="modes"
      aria-labelledby="modes-h"
      className="scroll-mt-20 py-16 sm:py-24"
    >
      <Reveal>
        <h2
          id="modes-h"
          className="max-w-2xl text-4xl font-extrabold sm:text-5xl"
        >
          Three ways to <span className="text-gradient">practise</span>.
        </h2>
      </Reveal>
      <div ref={ref} className="mt-10 space-y-6 md:space-y-0">
        {MODES.map((mode, i) => (
          <Card
            key={mode.key}
            mode={mode}
            i={i}
            progress={scrollYProgress}
            sticky={sticky}
          />
        ))}
      </div>
    </section>
  )
}
