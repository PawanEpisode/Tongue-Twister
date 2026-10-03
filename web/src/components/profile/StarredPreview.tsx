import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Star } from 'lucide-react'
import { EmptyState, ErrorState } from '#/components/feedback'
import { TwisterGrid, TwisterGridSkeleton } from '#/components/TwisterList'
import { Button } from '#/components/ui/button'
import { api } from '#/lib/api'
import { useAuth } from '#/lib/auth'

const PREVIEW = 6

/** The latest starred twisters, same query key as /favorites so the two stay in step. */
export default function StarredPreview() {
  const { session } = useAuth()
  const userId = session?.user.id
  const q = useQuery({
    queryKey: ['favorites', 'preview', userId],
    queryFn: () => api.favorites(1),
    enabled: !!userId,
  })
  return (
    <section aria-labelledby="starred-h">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 id="starred-h" className="text-2xl font-bold">
          Starred
        </h2>
        {q.data && q.data.count > PREVIEW && (
          <Link
            to="/favorites"
            className="text-sm underline underline-offset-2"
          >
            See all {q.data.count}
          </Link>
        )}
      </div>
      {q.isPending ? (
        <TwisterGridSkeleton n={3} />
      ) : q.isError ? (
        <ErrorState
          compact
          title="Couldn’t load your starred twisters"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.results.length === 0 ? (
        <EmptyState
          title="Nothing starred yet"
          hint="Tap the star on any twister to keep it close."
          action={
            <Button asChild variant="outline">
              <Link to="/twisters">
                <Star className="size-4" aria-hidden />
                Browse twisters
              </Link>
            </Button>
          }
        />
      ) : (
        <TwisterGrid items={q.data.results.slice(0, PREVIEW)} />
      )}
    </section>
  )
}
