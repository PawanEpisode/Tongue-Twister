import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { TwisterCard } from '#/components/ui'
import { Button } from '#/components/ui/button'
import { ErrorState, TwisterCardSkeleton } from '#/components/feedback'
import type { Twister } from '#/lib/api'

type TwisterPage = { count: number; results: Twister[] }

/** The 3-column card grid shared by Browse and Favourites. */
export function TwisterGridSkeleton({ n = 9 }: { n?: number }) {
  return (
    <div
      className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-busy
      aria-label="Loading twisters"
    >
      {Array.from({ length: n }, (_, i) => (
        <TwisterCardSkeleton key={i} />
      ))}
    </div>
  )
}

export function TwisterGrid({
  items,
  loadingMore = false,
}: {
  items: Twister[]
  loadingMore?: boolean
}) {
  return (
    <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((t, i) => (
        <TwisterCard key={t.slug} t={t} i={i % 24} />
      ))}
      {loadingMore &&
        Array.from({ length: 3 }, (_, i) => (
          <TwisterCardSkeleton key={`sk${i}`} />
        ))}
    </div>
  )
}

/**
 * A paged list of twisters with every state: loading skeleton, error with retry, `empty`, and
 * "Load more". Pass the infinite query; nothing else about where the data came from matters.
 */
export function PagedTwisters({
  query,
  empty,
}: {
  query: UseInfiniteQueryResult<InfiniteData<TwisterPage>>
  empty: ReactNode
}) {
  const items = query.data?.pages.flatMap((p) => p.results) ?? []
  const total = query.data?.pages[0]?.count ?? 0

  if (query.isError && !items.length)
    return (
      <ErrorState error={query.error} onRetry={() => void query.refetch()} />
    )
  if (query.isPending) return <TwisterGridSkeleton />
  if (!items.length) return <>{empty}</>
  return (
    <>
      <p className="mt-6 text-sm text-muted-foreground" aria-live="polite">
        Showing {items.length} of {total}
      </p>
      <TwisterGrid items={items} loadingMore={query.isFetchingNextPage} />
      {query.isError && (
        <ErrorState
          compact
          title="Couldn’t load more"
          error={query.error}
          onRetry={() => void query.fetchNextPage()}
        />
      )}
      {query.hasNextPage && !query.isError && (
        <div className="mt-8 text-center">
          <Button
            variant="outline"
            size="lg"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </>
  )
}
