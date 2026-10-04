import {
  AnimatePresence,
  m,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
} from 'motion/react'
import { useRef, useState } from 'react'
import { Reveal } from '#/components/public/motion/Reveal'
import { STEPS } from '#/content/landing'
import { cn } from '#/lib/utils'
import { FramePick, FrameSay, FrameScore } from './Frames'
import { useMediaQuery } from './useMediaQuery'

export default function HowItWorks() {
  const wide = useMediaQuery('(min-width: 768px)')
  const reduce = useReducedMotion()
  return (
    <section
      id="how"
      aria-labelledby="how-h"
      className="scroll-mt-20 py-16 sm:py-24"
    >
      <Reveal>
        <h2
          id="how-h"
          className="max-w-2xl text-4xl font-extrabold sm:text-5xl"
        >
          Three steps from <span className="text-gradient">mumble</span> to
          mastery.
        </h2>
      </Reveal>
      {wide && !reduce ? <Pinned /> : <Stacked />}
    </section>
  )
}

function Stacked() {
  return (
    <ol className="mt-10 space-y-10">
      {STEPS.map((s, i) => (
        <li key={s.title}>
          <Reveal>
            <p className="text-sm font-semibold text-brand">Step {i + 1}</p>
            <h3 className="mt-1 text-2xl font-bold">{s.title}</h3>
            <p className="mt-1 mb-4 text-muted-foreground">{s.body}</p>
            {i === 0 ? (
              <FramePick />
            ) : i === 1 ? (
              <FrameSay lit={7} />
            ) : (
              <FrameScore />
            )}
          </Reveal>
        </li>
      ))}
    </ol>
  )
}

/** Left column pins; the frame on the right changes as you scroll. Native scroll, nothing is trapped. */
function Pinned() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end end'],
  })
  const [p, setP] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (v) =>
    setP(Math.min(0.999, Math.max(0, v))),
  )
  const step = Math.floor(p * STEPS.length)
  const inStep = p * STEPS.length - step
  return (
    <div
      ref={ref}
      style={{ height: `${STEPS.length * 80}svh` }}
      className="relative mt-10"
    >
      <div className="sticky top-24 grid items-center gap-10 md:grid-cols-[1fr_1.2fr]">
        <ol className="relative space-y-6 border-l border-border pl-6">
          <m.span
            aria-hidden
            className="absolute top-0 -left-px h-full w-0.5 origin-top bg-gradient-to-b from-brand to-pink"
            style={{ scaleY: scrollYProgress }}
          />
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className={cn(
                'transition-opacity duration-300',
                i === step ? 'opacity-100' : 'opacity-40',
              )}
            >
              <p className="text-sm font-semibold text-brand">Step {i + 1}</p>
              <h3 className="text-2xl font-bold">{s.title}</h3>
              <p className="text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
        <div className="min-h-72">
          <AnimatePresence mode="wait">
            <m.div
              key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
            >
              {step === 0 ? (
                <FramePick />
              ) : step === 1 ? (
                <FrameSay lit={Math.round(inStep * 8)} />
              ) : (
                <FrameScore />
              )}
            </m.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
