import { useQuery } from '@tanstack/react-query'
import { ErrorState, Skeleton } from '#/components/feedback'
import { Card } from '#/components/ui/card'
import { api } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { AchievementGrid } from './AchievementGrid'

/** All achievements with progress. Loading, error-with-retry and empty states are handled here. */
export function AchievementsSection() {
  const { session } = useAuth()
  const q = useQuery({
    queryKey: ['achievements', session?.user.id],
    queryFn: api.achievements,
    enabled: !!session,
  })
  return (
    <section aria-labelledby="achievements-h" id="achievements">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="achievements-h" className="text-2xl font-bold">
          Achievements
        </h2>
        {q.data && (
          <p className="text-sm text-muted-foreground">
            {q.data.unlocked} of {q.data.total} unlocked
          </p>
        )}
      </div>
      {q.isPending ? (
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy
          aria-label="Loading achievements"
        >
          {Array.from({ length: 6 }, (_, i) => (
            <Card
              key={i}
              variant="glass"
              className="rounded-2xl p-4"
              aria-hidden
            >
              <Skeleton className="h-11 w-full" />
            </Card>
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState
          compact
          title="Couldn’t load your achievements"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.results.length === 0 ? (
        <p className="text-muted-foreground">
          Achievements will show up here as soon as they’re available.
        </p>
      ) : (
        <AchievementGrid items={q.data.results} />
      )}
    </section>
  )
}
