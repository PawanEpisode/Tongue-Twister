import { Check, EqualApproximately, Minus, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { FEEDBACK_COMMENT_MAX } from '#/lib/api'
import type { WordFeedback } from '#/lib/api'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { extraWords, problemRows, summarise } from '#/lib/speak/display'
import type { DisplayWord, WordRow } from '#/lib/speak/display'
import type { WordStatus } from '#/lib/speak/similarity'
import { cn } from '#/lib/utils'

/**
 * The mistakes view: the twister with every word marked, then what we heard for the ones to fix.
 * Colour is never the only cue — each status also has a glyph and a screen-reader label.
 */
export const WORD_LOOK: Record<
  Exclude<WordStatus, 'extra'>,
  { Icon: LucideIcon; label: string; className: string }
> = {
  correct: { Icon: Check, label: 'correct', className: 'text-lime' },
  near: {
    Icon: EqualApproximately,
    label: 'close',
    className: 'text-amber-500 underline decoration-dotted underline-offset-4',
  },
  wrong: {
    Icon: X,
    label: 'wrong',
    className: 'text-pink underline decoration-wavy underline-offset-4',
  },
  missed: {
    Icon: Minus,
    label: 'missed',
    className:
      'text-muted-foreground line-through decoration-2 underline-offset-4',
  },
}

export type FeedbackHandler = (
  targetIndex: number,
  feedback: WordFeedback,
) => Promise<void>

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
  onFeedback?: FeedbackHandler
}) {
  const problems = problemRows(rows)
  const extras = extraWords(rows)
  return (
    <section aria-label="Word by word" className="mt-6 text-left">
      <p className="text-center font-display text-lg font-semibold leading-relaxed">
        {display.map((w, i) => {
          const s = statuses[i]
          const look = s && s !== 'extra' ? WORD_LOOK[s] : null
          return (
            <span key={i} className={cn('mr-2 inline-block', look?.className)}>
              {look && (
                <>
                  <span aria-hidden className="mr-0.5 inline-flex align-[-2px]">
                    <look.Icon className="size-3" />
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
  onFeedback?: FeedbackHandler
}) {
  const look = WORD_LOOK[row.status as Exclude<WordStatus, 'extra'>]
  return (
    <li className="rounded-xl bg-background/60 px-3 py-2">
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
      {onFeedback && (
        <FeedbackForm onSend={(fb) => onFeedback(row.targetIndex!, fb)} />
      )}
    </li>
  )
}

/** "Was this fair?" — agree, or say you said it right, with an optional short note. */
function FeedbackForm({
  onSend,
}: {
  onSend: (feedback: WordFeedback) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const noteId = useId()
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed'>(
    'idle',
  )
  const send = async (judged_correct: boolean) => {
    setState('sending')
    try {
      await onSend({ judged_correct, comment: note.trim() || undefined })
      setState('sent')
    } catch {
      setState('failed')
    }
  }
  if (state === 'sent')
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Thanks for the feedback!
      </p>
    )
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-xs text-muted-foreground underline underline-offset-2"
      >
        Was this fair?
      </button>
    )
  const busy = state === 'sending'
  return (
    <div className="mt-2 space-y-2">
      <div className="block text-xs text-muted-foreground">
        <Label
          htmlFor={noteId}
          className="text-xs font-normal text-muted-foreground"
        >
          Add a note (optional)
        </Label>
        <Input
          id={noteId}
          value={note}
          maxLength={FEEDBACK_COMMENT_MAX}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 px-2 py-1 text-sm"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send(true)} // the verdict was right
          className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-card disabled:opacity-60"
        >
          Fair
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void send(false)}
          className="rounded-full border border-border px-2.5 py-1 text-xs hover:bg-card disabled:opacity-60"
        >
          I said it right
        </button>
      </div>
      {state === 'failed' && (
        <p role="alert" className="text-xs text-pink">
          Couldn’t send — try again.
        </p>
      )}
    </div>
  )
}
