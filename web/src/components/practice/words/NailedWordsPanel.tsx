import { Check, Sparkles, Trophy } from 'lucide-react'
import { useMemo } from 'react'
import QueueBoundary from './QueueBoundary'
import ShowMore from './ShowMore'
import WordCard from './WordCard'
import type { NailedWord } from '#/lib/api'
import { nailedLabel } from '#/lib/nailedLabel'
import type { WordQueue } from '#/lib/wordQueues'
import { groupNailed, nailedThisWeek } from '#/lib/wordsView'

/** Words passed in a drill. A word that slips later goes back to "To work on" by itself. */
export default function NailedWordsPanel({
  queue,
  onHear,
}: {
  queue: WordQueue<NailedWord>
  onHear?: (word: string) => void
}) {
  const { query, items, count, remaining } = queue
  const groups = useMemo(() => groupNailed(items), [items])
  const week = nailedThisWeek(items)
  // Newest first: if every loaded word is from this week, more of them may be waiting on the next page.
  const weekLabel = remaining > 0 && week === items.length ? `${week}+` : week
  return (
    <div role="tabpanel" aria-label="Nailed">
      <QueueBoundary
        pending={query.isPending}
        error={query.isError}
        empty={count === 0}
        emptyText="Words you nail in a drill collect here."
        errorText="Couldn’t load your nailed words."
        onRetry={() => void query.refetch()}
      >
        {week > 0 && (
          <div className="mt-6 flex items-center gap-4 rounded-3xl border border-lime/30 bg-gradient-to-r from-lime/15 via-brand/10 to-transparent p-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-lime/20 text-lime">
              <Trophy className="size-6" aria-hidden />
            </span>
            <div>
              <p className="font-display text-xl font-extrabold">
                {weekLabel} {week === 1 ? 'word' : 'words'} nailed this week
              </p>
              <p className="text-sm text-muted-foreground">
                {count} nailed in all. Each one is a sound you no longer trip
                on.
              </p>
            </div>
            <Sparkles
              className="ml-auto hidden size-6 text-lime/70 sm:block"
              aria-hidden
            />
          </div>
        )}
        {groups.map((g) => (
          <section key={g.key} aria-label={g.label} className="mt-6">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {g.label}
              <span className="rounded-full bg-muted px-2 py-0.5 font-normal tabular-nums normal-case tracking-normal">
                {g.items.length}
              </span>
            </h3>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((w) => (
                <WordCard
                  key={w.word}
                  word={w.word}
                  respelling={w.respelling}
                  tone="nailed"
                  status={
                    <span className="inline-flex items-center gap-1.5 font-semibold text-lime">
                      <Check className="size-3.5" aria-hidden />
                      Nailed {nailedLabel(w.mastered_at)}
                    </span>
                  }
                  onHear={onHear && (() => onHear(w.word))}
                />
              ))}
            </ul>
          </section>
        ))}
        <ShowMore
          remaining={remaining}
          loading={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        />
      </QueueBoundary>
    </div>
  )
}
