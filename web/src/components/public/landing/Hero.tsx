import { Orb } from '#/components/public/motion/Parallax'
import { Reveal } from '#/components/public/motion/Reveal'
import DemoCard from '#/components/public/DemoCard'
import { Button } from '#/components/ui/button'
import { HERO } from '#/content/landing'
import { useFlag } from '#/lib/flags'
import { useGate } from '#/lib/gate/useGate'
import { track } from '#/lib/observability/analytics'

export default function Hero() {
  const { request } = useGate()
  const demo = useFlag('landing_demo')
  const tryIt = () => {
    track('landing_cta_clicked', { where: 'hero' })
    const el = document.getElementById('demo')
    el?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'center',
    })
    el?.querySelector<HTMLButtonElement>('button')?.focus({
      preventScroll: true,
    })
  }
  return (
    <section className="relative isolate grid items-center gap-10 pt-6 pb-20 md:min-h-[min(46rem,100svh)] md:grid-cols-[1.15fr_1fr] md:pt-10">
      <Orb className="-top-24 -left-24 -z-10 size-96 bg-brand/25" />
      <Orb speed={0.2} className="top-40 -right-24 -z-10 size-96 bg-pink/20" />
      <div>
        <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-brand">
          {HERO.eyebrow}
        </p>
        <h1 className="text-5xl leading-[1.04] font-extrabold md:text-7xl">
          {HERO.before}{' '}
          <span className="text-gradient whitespace-nowrap">{HERO.accent}</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          {HERO.sub}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button
            size="lg"
            onClick={() =>
              demo
                ? tryIt()
                : request({ intent: 'hero_cta', returnTo: '/twisters' })
            }
            className="shadow-lg shadow-primary/30"
          >
            Try it now
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              track('landing_cta_clicked', { where: 'hero' })
              request({ intent: 'hero_cta', returnTo: '/twisters' })
            }}
          >
            Start free
          </Button>
        </div>
        <ul className="mt-6 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {HERO.chips.map((c) => (
            <li key={c} className="rounded-full border border-border px-3 py-1">
              {c}
            </li>
          ))}
        </ul>
      </div>
      {demo && (
        <Reveal>
          <DemoCard />
        </Reveal>
      )}
    </section>
  )
}
