import QueueBoundary from './QueueBoundary'
import ShowMore from './ShowMore'
import WordRow from './WordRow'
import type { NailedWord } from '#/lib/api'
import { nailedLabel } from '#/lib/nailedLabel'
import type { WordQueue } from '#/lib/wordQueues'

/** Words passed in a drill. A word that slips later goes back to "To work on" by itself. */
export default function NailedWordsPanel({
  queue,
}: {
  queue: WordQueue<NailedWord>
}) {
  const { query, items, count, remaining } = queue
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
        <ul className="mt-4 space-y-2">
          {items.map((w) => (
            <WordRow
              key={w.word}
              word={w.word}
              respelling={w.respelling}
              detail={`Nailed ${nailedLabel(w.mastered_at)}`}
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
