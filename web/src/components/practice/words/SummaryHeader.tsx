import { useEffect, useState } from 'react'
import { nailedShare } from '#/lib/wordsView'

const R = 44
const CIRC = 2 * Math.PI * R

/** The practice page's headline: how much of the trouble list is nailed, as a ring, with the three numbers behind it. */
export default function SummaryHeader({
  nailed,
  weak,
  due,
}: {
  nailed: number
  weak: number
  due: number
}) {
  const share = nailedShare(nailed, weak)
  const pct = Math.round(share * 100)
  // Draw the ring in from empty so the number it lands on feels earned.
  const [shown, setShown] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(share))
    return () => cancelAnimationFrame(id)
  }, [share])

  const total = nailed + weak
  const message =
    total === 0
      ? 'Say a few twisters and the words you trip on will collect here.'
      : weak === 0
        ? 'Every trouble word is nailed. Nicely done.'
        : share >= 0.75
          ? 'Nearly there — most of your trouble words are nailed.'
          : due > 0
            ? `${due} ${due === 1 ? 'word is' : 'words are'} ready for another go.`
            : 'Nothing is due right now. New misses will land here.'

  return (
    <section
      aria-label="Your word progress"
      className="glass mt-6 flex flex-col items-center gap-5 rounded-3xl p-5 sm:flex-row sm:gap-8 sm:p-6"
    >
      <div
        className="relative size-28 shrink-0"
        role="img"
        aria-label={`${pct}% of your trouble words nailed`}
      >
        <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden>
          <defs>
            <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--brand)" />
              <stop offset="100%" stopColor="var(--lime)" />
            </linearGradient>
          </defs>
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            strokeWidth="9"
            className="stroke-muted"
          />
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            stroke="url(#ring)"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - shown)}
            className="transition-[stroke-dashoffset] duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <span className="font-display text-3xl font-extrabold leading-none">
            {pct}%
          </span>
          <span className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            nailed
          </span>
        </div>
      </div>

      <div className="w-full min-w-0 flex-1 text-center sm:text-left">
        <p className="text-balance text-lg font-semibold">{message}</p>
        <dl className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="To work on" value={weak} className="text-pink" />
          <Stat label="Due now" value={due} className="text-brand" />
          <Stat label="Nailed" value={nailed} className="text-lime" />
        </dl>
      </div>
    </section>
  )
}

function Stat({
  label,
  value,
  className,
}: {
  label: string
  value: number
  className: string
}) {
  return (
    <div className="rounded-2xl bg-muted/50 px-3 py-2">
      <dd
        className={`font-display text-2xl font-extrabold tabular-nums ${className}`}
      >
        {value}
      </dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  )
}
