import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import WordFeedback from './WordFeedback'
import type { FeedbackHandler } from './WordFeedback'
import { WORD_LOOK } from './wordLook'
import { wordNotes } from '#/lib/speak/coaching'
import type { WordEntry } from '#/lib/speak/display'
import { cn } from '#/lib/utils'

const firstSlip = (entries: readonly WordEntry[]) =>
  Math.max(
    0,
    entries.findIndex((e) => e.status !== null && e.status !== 'correct'),
  )

/**
 * The twister in reading order, every word marked in place. Unheard words fade instead of piling up
 * as a list; tap (or arrow to) any word for a coaching line, and a flagged word can be disputed.
 */
export default function ReadItBack({
  entries,
  onFeedback,
}: {
  entries: readonly WordEntry[]
  /** Present only for saved attempts; called with the word's scoring index. */
  onFeedback?: FeedbackHandler
}) {
  const notes = useMemo(() => wordNotes(entries), [entries])
  const [picked, setPicked] = useState<number | null>(null)
  const selected = picked ?? firstSlip(entries)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const entry = entries[selected]

  const move = (to: number) => {
    const next = Math.min(entries.length - 1, Math.max(0, to))
    setPicked(next)
    refs.current[next]?.focus()
  }
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight') move(i + 1)
    else if (e.key === 'ArrowLeft') move(i - 1)
    else return
    e.preventDefault()
  }

  return (
    <section aria-label="Read it back">
      <h3 className="font-display text-base font-bold">Read it back</h3>
      <p className="mt-2 font-display text-lg leading-[2.1rem]">
        {entries.map((e, i) => {
          const look = e.status ? WORD_LOOK[e.status] : null
          return (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              tabIndex={i === selected ? 0 : -1}
              aria-pressed={i === selected}
              onClick={() => setPicked(i)}
              onKeyDown={(ev) => onKey(ev, i)}
              className={cn(
                'mr-1.5 rounded-md px-1 outline-none transition-colors',
                look?.word,
                'focus-visible:ring-2 focus-visible:ring-primary',
                i === selected && 'ring-2 ring-primary',
              )}
            >
              {look && <span className="sr-only">{look.label}: </span>}
              {e.text}
            </button>
          )
        })}
      </p>
      {entry && notes[selected] && (
        <div
          role="status"
          className="mt-3 rounded-r-xl border-l-4 border-primary bg-primary/10 px-4 py-3 text-sm"
        >
          <p>
            <b>{entry.text}</b> {notes[selected]}
          </p>
          {onFeedback &&
            entry.targetIndex != null &&
            entry.status !== 'correct' && (
              <WordFeedback
                key={entry.targetIndex}
                onSend={(fb) => onFeedback(entry.targetIndex!, fb)}
              />
            )}
        </div>
      )}
    </section>
  )
}
