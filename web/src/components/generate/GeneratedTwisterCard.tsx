import { Link } from '@tanstack/react-router'
import { Lightbulb } from 'lucide-react'
import { m, useReducedMotion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { DifficultyBadge } from '#/components/ui'
import { Button } from '#/components/ui/button'
import { useCelebrations } from '#/lib/preferences'
import { readAccentColors } from '#/lib/theme'
import type { GeneratedTwister } from '#/lib/generate/api'

/** A short line can sit large. A long one stays readable. */
function quoteClass(text: string) {
  return text.trim().split(/\s+/).length > 24
    ? 'text-lg leading-snug sm:text-xl'
    : 'text-2xl leading-snug sm:text-3xl'
}

function celebrate(reduce: boolean | null) {
  if (reduce) return
  // jsdom and locked-down browsers have no canvas. The card still lands.
  void import('canvas-confetti')
    .then(({ default: confetti }) =>
      confetti({
        particleCount: 70,
        spread: 72,
        origin: { y: 0.7 },
        colors: readAccentColors(),
      }),
    )
    .catch(() => undefined)
}

/** The reveal: the new line, in quotes, ready to say. */
export function GeneratedTwisterCard({
  twister,
}: {
  twister: GeneratedTwister
}) {
  const reduce = useReducedMotion()
  const celebrations = useCelebrations()
  const card = useRef<HTMLElement>(null)
  const level = twister.difficulty

  useEffect(() => {
    celebrate(reduce || !celebrations)
    card.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [twister.slug, reduce, celebrations])

  return (
    <m.section
      ref={card}
      aria-labelledby="generated-twister-title"
      initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="glass space-y-5 rounded-3xl p-5 sm:p-8"
    >
      <h2
        id="generated-twister-title"
        className="text-xs font-semibold uppercase tracking-widest text-brand"
      >
        Your new twister
      </h2>
      <blockquote>
        <p
          className={`text-pretty font-display font-bold ${quoteClass(twister.text)}`}
        >
          <span aria-hidden className="text-gradient">
            “
          </span>
          <span>{twister.text}</span>
          <span aria-hidden className="text-gradient">
            ”
          </span>
        </p>
      </blockquote>
      {(level || twister.word_count) && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {level ? <DifficultyBadge level={level} /> : null}
          {twister.word_count ? <span>{twister.word_count} words</span> : null}
        </div>
      )}
      {twister.tip ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Lightbulb
            className="mt-0.5 size-4 shrink-0 text-brand"
            aria-hidden
          />
          {twister.tip}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link to="/twisters/$slug" params={{ slug: twister.slug }}>
            Practise it
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/my-twisters">My twisters</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Only you can see this twister.
      </p>
    </m.section>
  )
}
