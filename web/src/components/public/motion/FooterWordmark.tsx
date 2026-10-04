import { m, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { useRef } from 'react'

/** The giant faded "Twister" at the bottom of the footer; rises and fades in as the footer arrives. */
export function FooterWordmark() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end end'],
  })
  const y = useTransform(scrollYProgress, [0, 1], [24, 0])
  const opacity = useTransform(scrollYProgress, [0, 1], [0, 1])
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none select-none overflow-hidden"
    >
      <m.div
        style={reduce ? undefined : { y, opacity }}
        className="-mb-[0.18em] text-center font-display text-[clamp(5rem,26vw,22rem)] leading-[0.9] font-extrabold tracking-tight text-gradient opacity-40"
      >
        Twister
      </m.div>
    </div>
  )
}
