import { Link } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { useState } from 'react'
import { Reveal } from '#/components/public/motion/Reveal'
import { SnapCarousel } from '#/components/public/motion/SnapCarousel'
import { DifficultyBadge } from '#/components/ui'
import { Button } from '#/components/ui/button'
import type { LandingPayload } from '#/lib/api'
import { useGate } from '#/lib/gate/useGate'
import { track } from '#/lib/observability/analytics'
import { cn } from '#/lib/utils'

export default function TwisterCarousel({ data }: { data?: LandingPayload }) {
  const { request } = useGate()
  const [level, setLevel] = useState<number | null>(null)
  const all = data?.teaser ?? []
  const shown = level ? all.filter((t) => t.difficulty === level) : all
  const more = Math.max(0, (data?.library_total ?? 0) - all.length)
  return (
    <section aria-labelledby="meet-h" className="py-16 sm:py-24">
      <Reveal>
        <h2
          id="meet-h"
          className="max-w-2xl text-4xl font-extrabold sm:text-5xl"
        >
          Meet a few <span className="text-gradient">twisters</span>.
        </h2>
        <div
          className="mt-6 flex flex-wrap gap-2"
          role="group"
          aria-label="Filter by level"
        >
          {[null, 1, 2, 3, 4].map((l) => (
            <button
              key={l ?? 'all'}
              aria-pressed={level === l}
              onClick={() => setLevel(l)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium',
                level === l
                  ? 'border-primary bg-primary/10'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {l ? ['', 'Easy', 'Medium', 'Hard', 'Insane'][l] : 'All'}
            </button>
          ))}
        </div>
      </Reveal>
      <div className="mt-6">
        {all.length === 0 ? (
          <div className="glass rounded-3xl p-8 text-center text-muted-foreground">
            Twisters load here in a moment.
          </div>
        ) : (
          <SnapCarousel label="Sample twisters">
            {shown.map((t) => (
              <Link
                key={t.slug}
                to="/twisters/$slug"
                params={{ slug: t.slug }}
                className="glass flex w-72 shrink-0 snap-start flex-col gap-3 rounded-3xl p-5 transition-colors hover:border-primary/60"
              >
                <DifficultyBadge level={t.difficulty} />
                <p className="font-display text-xl leading-snug">{t.text}</p>
              </Link>
            ))}
            <div className="glass flex w-72 shrink-0 snap-start flex-col justify-between gap-4 rounded-3xl p-5">
              <Lock className="size-6 text-brand" aria-hidden />
              <div>
                <p className="font-display text-2xl font-extrabold">
                  {more > 0 ? `+${more} more inside` : 'More inside'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Every level and sound family, free with an account.
                </p>
              </div>
              <Button
                onClick={() => {
                  track('landing_cta_clicked', { where: 'proof' })
                  request({ intent: 'locked_filter', returnTo: '/twisters' })
                }}
              >
                Start free
              </Button>
            </div>
          </SnapCarousel>
        )}
      </div>
    </section>
  )
}
