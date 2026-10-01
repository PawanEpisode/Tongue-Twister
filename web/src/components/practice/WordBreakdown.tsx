import { useMemo } from 'react'
import FixCard from '#/components/results/FixCard'
import ReadItBack from '#/components/results/ReadItBack'
import type { FeedbackHandler } from '#/components/results/WordFeedback'
import { topFix } from '#/lib/speak/coaching'
import { extraWords, summarise, wordEntries } from '#/lib/speak/display'
import type { DisplayWord, WordRow } from '#/lib/speak/display'

/**
 * The mistakes view: the twister read back with every word marked, then the one sound to fix.
 * `summarise` is the plain-text equivalent of the coloured passage.
 */
export default function WordBreakdown({
  display,
  rows,
  onFeedback,
}: {
  display: readonly DisplayWord[]
  rows: readonly WordRow[]
  /** Present only for saved attempts; called with the word's scoring index. */
  onFeedback?: FeedbackHandler
}) {
  const entries = useMemo(() => wordEntries(display, rows), [display, rows])
  const fix = useMemo(() => topFix(entries), [entries])
  const extras = extraWords(rows)
  return (
    <div className="mt-6 space-y-6 text-left">
      <ReadItBack entries={entries} onFeedback={onFeedback} />
      <p className="text-center text-xs text-muted-foreground" role="status">
        {summarise(rows)}
      </p>
      {fix && <FixCard fix={fix} />}
      {extras.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Extra words we heard: <b>{extras.join(', ')}</b>
        </p>
      )}
    </div>
  )
}
