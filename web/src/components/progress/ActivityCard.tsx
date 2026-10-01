import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ErrorState, Skeleton } from '#/components/feedback'
import { api } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { heatmapGrid } from '#/lib/progress/charts'
import { ActivityHeatmap } from './charts/ActivityHeatmap'
import { ChartCard } from './charts/ChartParts'

const WEEKS = 12

/** The last 12 weeks, day by day. Fetches its own data so a slow heatmap never blocks the rest of the page. */
export function ActivityCard() {
  const { session } = useAuth()
  const q = useQuery({
    queryKey: ['activity', session?.user.id, WEEKS],
    queryFn: () => api.activity(WEEKS),
    enabled: !!session,
  })
  const grid = useMemo(
    () => (q.data ? heatmapGrid(q.data.days, q.data.from, q.data.to) : null),
    [q.data],
  )
  return (
    <ChartCard
      title="Your last 12 weeks"
      description="Darker days mean more practice. A diamond marks a day a streak freeze covered."
    >
      {q.isPending ? (
        <div aria-busy aria-label="Loading activity">
          <Skeleton className="h-36 w-full" />
        </div>
      ) : q.isError ? (
        <ErrorState
          compact
          title="Couldn’t load your activity"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.days.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Your first twister lights up the first square.
        </p>
      ) : (
        grid && <ActivityHeatmap grid={grid} />
      )}
    </ChartCard>
  )
}
