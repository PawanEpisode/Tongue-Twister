import { m, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Reveal } from '#/components/public/motion/Reveal'
import { HERO_TABS } from '#/content/landing'
import { cn } from '#/lib/utils'

const MS = 6000

/** A product panel with three tabs that auto-advance. Pauses on hover, focus and when off screen. */
export default function ProductTabs() {
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([e]) => setVisible(!!e?.isIntersecting),
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const running = !reduce && !paused && visible
  useEffect(() => {
    if (!running) return
    const id = window.setTimeout(
      () => setI((n) => (n + 1) % HERO_TABS.length),
      MS,
    )
    return () => window.clearTimeout(id)
  }, [running, i])

  const tab = HERO_TABS[i]
  return (
    <Reveal>
      <div
        ref={ref}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
        className="glass mx-auto max-w-4xl rounded-3xl p-3 shadow-xl sm:p-4"
      >
        <div
          role="tablist"
          aria-label="Practice modes"
          className="flex gap-1 overflow-x-auto rounded-2xl bg-muted/40 p-1"
        >
          {HERO_TABS.map((t, n) => (
            <button
              key={t.key}
              role="tab"
              id={`ptab-${t.key}`}
              aria-selected={n === i}
              aria-controls="ptab-panel"
              tabIndex={n === i ? 0 : -1}
              onClick={() => setI(n)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') setI((i + 1) % HERO_TABS.length)
                if (e.key === 'ArrowLeft')
                  setI((i + HERO_TABS.length - 1) % HERO_TABS.length)
              }}
              className={cn(
                'relative flex-1 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors',
                n === i
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {n === i && running && (
                <m.span
                  key={`${i}-bar`}
                  aria-hidden
                  className="absolute inset-x-3 bottom-0 h-0.5 origin-left rounded-full bg-gradient-to-r from-brand to-pink"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: MS / 1000, ease: 'linear' }}
                />
              )}
            </button>
          ))}
        </div>
        <div
          id="ptab-panel"
          role="tabpanel"
          aria-labelledby={`ptab-${tab.key}`}
          className="px-3 py-8 text-center sm:px-8 sm:py-12"
        >
          <p className="text-sm text-muted-foreground">{tab.line}</p>
          <p
            className="mt-5 font-display text-3xl leading-snug sm:text-4xl"
            aria-label={tab.words.join(' ')}
          >
            {tab.words.map((w, n) => (
              <span
                key={`${tab.key}-${n}`}
                style={{ transitionDelay: reduce ? '0ms' : `${n * 120}ms` }}
                className={cn(
                  'mr-[0.3em] inline-block rounded-md px-0.5 transition-colors duration-500',
                  n < tab.lit ? 'bg-lime/20 text-lime' : 'text-foreground',
                  tab.key === 'speak' && n === 3 && 'bg-pink/20 text-pink',
                )}
              >
                {w}
              </span>
            ))}
          </p>
          <p className="mt-6 text-xs text-muted-foreground">Sample frame</p>
        </div>
      </div>
    </Reveal>
  )
}
