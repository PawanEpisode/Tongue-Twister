import { m, useReducedMotion, useScroll, useTransform } from 'motion/react'
import { useRef } from 'react'
import { Button } from '#/components/ui/button'
import { FINAL } from '#/content/landing'
import { useGate } from '#/lib/gate/useGate'
import { track } from '#/lib/observability/analytics'

export default function FinalCta() {
  const { request } = useGate()
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'center center'],
  })
  const scale = useTransform(scrollYProgress, [0, 1], [0.96, 1])
  return (
    <section aria-labelledby="final-h" className="py-16 sm:py-24">
      <m.div
        ref={ref}
        style={reduce ? undefined : { scale }}
        className="relative overflow-hidden rounded-[2rem] border border-border bg-gradient-to-br from-brand/30 via-pink/20 to-cyan/20 p-8 text-center sm:p-16"
      >
        <h2 id="final-h" className="text-4xl font-extrabold sm:text-6xl">
          {FINAL.title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          {FINAL.body}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button
            size="lg"
            onClick={() => {
              track('landing_cta_clicked', { where: 'final' })
              request({ intent: 'footer_cta', returnTo: '/twisters' })
            }}
          >
            Start free
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() =>
              document.getElementById('demo')?.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                  .matches
                  ? 'auto'
                  : 'smooth',
                block: 'center',
              })
            }
          >
            Try the demo again
          </Button>
        </div>
      </m.div>
    </section>
  )
}
