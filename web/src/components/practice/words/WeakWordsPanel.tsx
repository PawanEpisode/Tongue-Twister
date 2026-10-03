import { Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import QueueBoundary from './QueueBoundary'
import ShowMore from './ShowMore'
import WordCard from './WordCard'
import { Button } from '#/components/ui/button'
import { Chip } from '#/components/ui/chip'
import { Input } from '#/components/ui/input'
import type { DrillItem } from '#/components/practice/WordDrill'
import type { WeakWord } from '#/lib/api'
import { dueLabel } from '#/lib/dueLabel'
import type { WordQueue } from '#/lib/wordQueues'
import {
  WEAK_SORTS,
  filterWords,
  isDueNow,
  missedCount,
  sortWeak,
  weaknessTone,
} from '#/lib/wordsView'
import type { WeakSort } from '#/lib/wordsView'

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
  onHear,
}: {
  queue: WordQueue<WeakWord>
  dueOnly: boolean
  onDueOnly: (on: boolean) => void
  onDrill: (items: DrillItem[]) => void
  /** Plays a word aloud; omit where speech synthesis is unavailable. */
  onHear?: (word: string) => void
}) {
  const searchId = useId()
  const sortId = useId()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<WeakSort>('weakest')
  const { query, items, count, remaining } = queue
  // "Drill N weakest" always means the weakest by the server's ranking, whatever order is on screen.
  const drillable = items.filter(canDrill)
  const shown = useMemo(
    () => sortWeak(filterWords(items, search), sort),
    [items, search, sort],
  )
  return (
    <div role="tabpanel" aria-label="To work on">
      <div className="mt-6 flex flex-wrap items-center gap-2">
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

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <label htmlFor={searchId} className="sr-only">
            Search your words
          </label>
          <Input
            id={searchId}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search words"
            className="py-2 pl-10 pr-9 text-sm"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
        <label htmlFor={sortId} className="sr-only">
          Sort words
        </label>
        <select
          id={sortId}
          value={sort}
          onChange={(e) => setSort(e.target.value as WeakSort)}
          className="rounded-xl border border-input bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        >
          {WEAK_SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <Chip on={dueOnly} onClick={() => onDueOnly(!dueOnly)}>
          Due for review only
        </Chip>
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
        {shown.length === 0 ? (
          <p className="mt-6 text-center text-muted-foreground">
            No loaded words match “{search.trim()}”.
            {remaining > 0 && ' Show more to search the rest.'}
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((w) => {
              const { tone, label } = weaknessTone(w.miss_rate)
              const missed = missedCount(w)
              const due = isDueNow(w.next_review_at)
              return (
                <WordCard
                  key={w.word}
                  word={w.word}
                  respelling={w.respelling}
                  tone={tone}
                  meter={{
                    value: w.miss_rate,
                    label: `Missed ${Math.round(w.miss_rate * 100)}% of ${w.seen} ${w.seen === 1 ? 'time' : 'times'}`,
                    caption: `${label} · missed ${missed} of ${w.seen}`,
                  }}
                  status={
                    <span
                      className={
                        due
                          ? 'rounded-full bg-primary/20 px-2 py-0.5 font-semibold text-foreground'
                          : 'rounded-full bg-muted px-2 py-0.5'
                      }
                    >
                      {dueLabel(w.next_review_at).replace(/^./, (c) =>
                        c.toUpperCase(),
                      )}
                    </span>
                  }
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
                  onHear={onHear && (() => onHear(w.word))}
                />
              )
            })}
          </ul>
        )}
        <ShowMore
          remaining={remaining}
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        />
      </QueueBoundary>
    </div>
  )
}
