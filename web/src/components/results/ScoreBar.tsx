import { TARGET_STATUSES, WORD_LOOK } from './wordLook'
import { cn } from '#/lib/utils'
import type { Tally } from '#/lib/speak/display'

/** The take at a glance: one segment per outcome, widths in proportion, with a legend below. */
export default function ScoreBar({ tally }: { tally: Tally }) {
  const total = TARGET_STATUSES.reduce((n, s) => n + tally[s], 0)
  if (!total) return null
  const parts = TARGET_STATUSES.filter((s) => tally[s] > 0)
  const summary = parts
    .map((s) => `${tally[s]} ${WORD_LOOK[s].legend}`)
    .join(', ')
  return (
    <div>
      <div
        role="img"
        aria-label={`Word results: ${summary}`}
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
      >
        {parts.map((s) => (
          <span
            key={s}
            className={cn('h-full', WORD_LOOK[s].swatch)}
            style={{ flexGrow: tally[s] }}
          />
        ))}
      </div>
      <ul
        aria-hidden
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      >
        {parts.map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2 rounded-full', WORD_LOOK[s].swatch)} />
            {tally[s]} {WORD_LOOK[s].legend}
          </li>
        ))}
      </ul>
    </div>
  )
}
