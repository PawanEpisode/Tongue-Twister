import { Volume2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Tone } from '#/lib/wordsView'
import { cn } from '#/lib/utils'

const BAR: Record<Tone | 'nailed', string> = {
  high: 'bg-pink',
  mid: 'bg-brand',
  low: 'bg-lime',
  nailed: 'bg-lime',
}
const TEXT: Record<Tone | 'nailed', string> = {
  high: 'text-pink',
  mid: 'text-brand',
  low: 'text-lime',
  nailed: 'text-lime',
}

/** One word as a card: the word and how to say it, an optional miss meter, a status line and an action. */
export default function WordCard({
  word,
  respelling,
  tone,
  meter,
  status,
  action,
  onHear,
}: {
  word: string
  respelling?: string
  tone: Tone | 'nailed'
  /** The miss meter: `value` 0–1 fills it; `caption` names it for sighted and screen-reader users alike. */
  meter?: { value: number; label: string; caption: string }
  status: ReactNode
  action?: ReactNode
  /** Plays the word. Omit where speech synthesis is unavailable. */
  onHear?: () => void
}) {
  return (
    <li className="glass group relative flex flex-col gap-3 overflow-hidden rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg hover:shadow-primary/10">
      <span
        aria-hidden
        className={cn('absolute inset-y-0 left-0 w-1', BAR[tone])}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <b className="block truncate font-display text-xl leading-tight">
            {word}
          </b>
          {respelling && (
            <span className="block truncate text-sm text-muted-foreground">
              {respelling}
            </span>
          )}
        </div>
        {onHear && (
          <button
            type="button"
            onClick={onHear}
            aria-label={`Hear ${word}`}
            className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-muted-foreground outline-none transition-colors hover:border-primary hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:size-11"
          >
            <Volume2 className="size-4" aria-hidden />
          </button>
        )}
      </div>

      {meter && (
        <div>
          <div
            role="meter"
            aria-label={meter.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(meter.value * 100)}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-700',
                BAR[tone],
              )}
              style={{
                width: `${Math.max(6, Math.round(meter.value * 100))}%`,
              }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            <span className={cn('font-semibold', TEXT[tone])}>
              {meter.caption}
            </span>
          </p>
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <div className="min-w-0 text-xs text-muted-foreground">{status}</div>
        {action}
      </div>
    </li>
  )
}
