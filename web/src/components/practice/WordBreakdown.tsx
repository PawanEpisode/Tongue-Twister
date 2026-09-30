import { useState } from 'react'
import { extraWords, problemRows, summarise } from '#/lib/speak/display'
import type { DisplayWord, WordRow } from '#/lib/speak/display'
import type { WordStatus } from '#/lib/speak/similarity'
import { cn } from '#/lib/utils'

/**
 * The mistakes view: the twister with every word marked, then what we heard for the ones to fix.
 * Colour is never the only cue — each status also has a glyph and a screen-reader label.
 */
const LOOK: Record<
  Exclude<WordStatus, 'extra'>,
  { glyph: string; label: string; className: string }
> = {
  correct: { glyph: '✓', label: 'correct', className: 'text-lime' },
  near: {
    glyph: '≈',
    label: 'close',
    className: 'text-amber-500 underline decoration-dotted underline-offset-4',
  },
  wrong: {
    glyph: '✗',
    label: 'wrong',
    className: 'text-pink underline decoration-wavy underline-offset-4',
  },
  missed: {
    glyph: '–',
    label: 'missed',
    className:
      'text-muted-foreground line-through decoration-2 underline-offset-4',
  },
}

const REASON_TEXT = {
  focus_swap: 'the sound this twister trains',
  homophone: 'sounds the same',
  '': '',
} as const

export default function WordBreakdown({
  display,
  statuses,
  rows,
  onFeedback,
}: {
  display: readonly DisplayWord[]
  statuses: readonly (WordStatus | null)[]
  rows: readonly WordRow[]
  /** Present only for saved attempts; called with the word's scoring index. */
  onFeedback?: (targetIndex: number) => Promise<void>
}) {
  const problems = problemRows(rows)
  const extras = extraWords(rows)
  return (
    <section aria-label="Word by word" className="mt-6 text-left">
      <p className="text-center font-display text-lg font-semibold leading-relaxed">
        {display.map((w, i) => {
          const s = statuses[i]
          const look = s && s !== 'extra' ? LOOK[s] : null
          return (
            <span key={i} className={cn('mr-2 inline-block', look?.className)}>
              {look && (
                <>
                  <span aria-hidden className="mr-0.5 text-xs">
                    {look.glyph}
                  </span>
                  <span className="sr-only">{look.label}: </span>
                </>
              )}
              {w.text}
            </span>
          )
        })}
      </p>
      <p
        className="mt-2 text-center text-xs text-muted-foreground"
        role="status"
      >
        {summarise(rows)}
      </p>

      {problems.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {problems.map((r) => (
            <ProblemItem
              key={r.targetIndex}
              row={r}
              target={targetOf(display, r)}
              onFeedback={onFeedback}
            />
          ))}
        </ul>
      )}
      {extras.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Extra words we heard: <b>{extras.join(', ')}</b>
        </p>
      )}
    </section>
  )
}

// A row only knows its scoring index; show the word as the twister prints it (minus punctuation).
function targetOf(display: readonly DisplayWord[], row: WordRow): string {
  const d = display.find(
    (w) => row.targetIndex! >= w.from && row.targetIndex! < w.to,
  )
  return d?.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') ?? ''
}

function ProblemItem({
  row,
  target,
  onFeedback,
}: {
  row: WordRow
  target: string
  onFeedback?: (targetIndex: number) => Promise<void>
}) {
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'failed'>(
    'idle',
  )
  const look = LOOK[row.status as Exclude<WordStatus, 'extra'>]
  const send = async () => {
    setSent('sending')
    try {
      await onFeedback!(row.targetIndex!)
      setSent('sent')
    } catch {
      setSent('failed')
    }
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background/60 px-3 py-2">
      <span>
        <b>{target}</b>{' '}
        {row.status === 'missed' ? (
          <span className="text-muted-foreground">— we didn’t hear it</span>
        ) : (
          <span className="text-muted-foreground">
            — we heard “{row.spoken}”
          </span>
        )}
        <span className="sr-only"> ({look.label})</span>
        {REASON_TEXT[row.reason] && (
          <span className="ml-1 text-xs text-muted-foreground">
            · {REASON_TEXT[row.reason]}
          </span>
        )}
      </span>
      {onFeedback && row.status !== 'missed' && (
        <button
          type="button"
          disabled={sent === 'sending' || sent === 'sent'}
          onClick={() => void send()}
          className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-card disabled:opacity-60"
        >
          {sent === 'sent'
            ? 'Thanks!'
            : sent === 'failed'
              ? 'Couldn’t send — retry'
              : 'I said it right'}
        </button>
      )}
    </li>
  )
}
