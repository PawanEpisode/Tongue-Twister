import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Reveal } from '#/components/public/motion/Reveal'
import { PERSONAS } from '#/content/landing'
import { cn } from '#/lib/utils'

export default function Personas() {
  const [i, setI] = useState(0)
  const p = PERSONAS[i]
  const move = (to: number) => {
    const n = (to + PERSONAS.length) % PERSONAS.length
    setI(n)
    document.getElementById(`persona-${PERSONAS[n].key}`)?.focus()
  }
  return (
    <section aria-labelledby="who-h" className="py-16 sm:py-24">
      <Reveal>
        <h2
          id="who-h"
          className="max-w-2xl text-4xl font-extrabold sm:text-5xl"
        >
          Made for anyone who <span className="text-gradient">talks</span> for a
          living, or for fun.
        </h2>
        <div
          role="tablist"
          aria-label="Who Twister is for"
          className="mt-8 flex gap-2 overflow-x-auto pb-1"
        >
          {PERSONAS.map((x, n) => (
            <button
              key={x.key}
              id={`persona-${x.key}`}
              role="tab"
              aria-selected={n === i}
              aria-controls="persona-panel"
              tabIndex={n === i ? 0 : -1}
              onClick={() => setI(n)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') move(i + 1)
                if (e.key === 'ArrowLeft') move(i - 1)
              }}
              className={cn(
                'whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
                n === i
                  ? 'border-primary bg-primary/10'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div
          id="persona-panel"
          role="tabpanel"
          aria-labelledby={`persona-${p.key}`}
          className="glass mt-4 max-w-3xl rounded-3xl p-6 sm:p-8"
        >
          <p className="text-lg">{p.body}</p>
          <p className="mt-3 font-semibold text-brand">{p.outcome}</p>
          <Link
            to="/twisters/$slug"
            params={{ slug: p.slug }}
            className="mt-5 inline-block text-sm font-semibold underline underline-offset-4"
          >
            Try a twister for this →
          </Link>
        </div>
      </Reveal>
    </section>
  )
}
