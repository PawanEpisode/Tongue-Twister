import { useInfiniteQuery } from '@tanstack/react-query'
import { BadgeCheck, Flame, Medal, Sparkles, Trophy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { EmptyState, ErrorState, Skeleton } from '#/components/feedback'
import { Button } from '#/components/ui/button'
import { api } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { describeEvent, groupByDay } from '#/lib/profile/timeline'
import type { TimelineIcon } from '#/lib/profile/timeline'

const ICONS: Record<TimelineIcon, LucideIcon> = {
  sparkles: Sparkles,
  trophy: Trophy,
  flame: Flame,
  'badge-check': BadgeCheck,
  medal: Medal,
}

/** Your journey so far: level-ups, badges, streaks, mastered twisters and personal bests. */
export default function ProfileTimeline() {
  const { session } = useAuth()
  const q = useInfiniteQuery({
    queryKey: ['timeline', session?.user.id],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.timeline(pageParam),
    getNextPageParam: (last, pages) =>
      pages.reduce((n, p) => n + p.results.length, 0) < last.count
        ? pages.length + 1
        : undefined,
    enabled: !!session,
  })
  const events = q.data?.pages.flatMap((p) => p.results) ?? []

  return (
    <section aria-labelledby="timeline-h">
      <h2 id="timeline-h" className="mb-3 text-2xl font-bold">
        Your journey
      </h2>
      {q.isPending ? (
        <div className="space-y-2" aria-busy aria-label="Loading your journey">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-2xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState
          compact
          title="Couldn’t load your journey"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : events.length === 0 ? (
        <EmptyState
          title="Your journey starts with your next attempt"
          hint="Level-ups, badges, streaks and personal bests will collect here."
        />
      ) : (
        <div className="space-y-5">
          {groupByDay(events).map((group) => (
            <div key={group.label}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <ol className="space-y-2 border-l border-border pl-4">
                {group.events.map((event) => {
                  const entry = describeEvent(event)
                  const Icon = ICONS[entry.icon]
                  return (
                    <li
                      key={event.id}
                      className="relative flex items-center gap-3"
                    >
                      <span
                        aria-hidden
                        className="absolute -left-[1.6rem] grid size-5 place-items-center rounded-full bg-background ring-1 ring-border"
                      >
                        <Icon className="size-3 text-primary" />
                      </span>
                      <span className="min-w-0 text-sm">
                        <span className="font-semibold">{entry.title}</span>
                        {entry.detail && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {entry.detail}
                          </span>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
          {q.hasNextPage && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                disabled={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {q.isFetchingNextPage ? 'Loading…' : 'Show earlier'}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
