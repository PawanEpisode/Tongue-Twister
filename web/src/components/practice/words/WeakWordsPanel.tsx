import { useId } from 'react'
import QueueBoundary from './QueueBoundary'
import ShowMore from './ShowMore'
import WordRow from './WordRow'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import type { DrillItem } from '#/components/practice/WordDrill'
import type { WeakWord } from '#/lib/api'
import { dueLabel } from '#/lib/dueLabel'
import type { WordQueue } from '#/lib/wordQueues'

/** Drill sessions on offer: the weakest few, so a drill stays short however long the queue is. */
export const SESSION_SIZES = [3, 5, 10] as const

export const canDrill = (w: WeakWord): w is DrillItem => w.drill !== null

/** Session lengths that fit the words available, e.g. 4 words -> 3 and 4. */
export const sessionSizes = (available: number): number[] =>
  available
    ? [...new Set(SESSION_SIZES.map((n) => Math.min(n, available)))]
    : []

export default function WeakWordsPanel({
  queue,
  dueOnly,
  onDueOnly,
  onDrill,
}: {
  queue: WordQueue<WeakWord>
  dueOnly: boolean
  onDueOnly: (on: boolean) => void
  onDrill: (items: DrillItem[]) => void
}) {
  const dueId = useId()
  const { query, items, count, remaining } = queue
  const drillable = items.filter(canDrill)
  return (
    <div role="tabpanel" aria-label="To work on">
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {sessionSizes(drillable.length).map((n, i) => (
            <Button
              key={n}
              variant={i === 0 ? 'default' : 'outline'}
              className="px-4 py-2"
              onClick={() => onDrill(drillable.slice(0, n))}
            >
              Drill {n} weakest
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            id={dueId}
            checked={dueOnly}
            onCheckedChange={(v) => onDueOnly(v === true)}
          />
          <Label htmlFor={dueId} className="font-normal text-muted-foreground">
            Due for review only
          </Label>
        </div>
      </div>
      <QueueBoundary
        pending={query.isPending}
        error={query.isError}
        empty={count === 0}
        emptyText={
          dueOnly
            ? 'Nothing is due for review right now.'
            : 'No trouble words yet — say a few twisters and the ones you trip on will show up here.'
        }
        errorText="Couldn’t load your words."
        onRetry={() => void query.refetch()}
      >
        <ul className="mt-4 space-y-2">
          {items.map((w) => (
            <WordRow
              key={w.word}
              word={w.word}
              respelling={w.respelling}
              detail={`Missed ${Math.round(w.miss_rate * 100)}% of ${w.seen} ${
                w.seen === 1 ? 'time' : 'times'
              } · ${dueLabel(w.next_review_at)}`}
              action={
                canDrill(w) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDrill([w])}
                    aria-label={`Drill ${w.word}`}
                  >
                    Drill
                  </Button>
                )
              }
            />
          ))}
        </ul>
        <ShowMore
          remaining={remaining}
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        />
      </QueueBoundary>
    </div>
  )
}
