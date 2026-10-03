import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Trophy } from 'lucide-react'
import { EmptyState, ErrorState, Skeleton } from '#/components/feedback'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { api } from '#/lib/api'
import { useAuth } from '#/lib/auth'

const SHOWN = 8

const KIND_LABEL = {
  test: 'Test',
  train: 'Train',
  drill: 'Drill',
  record: 'Record',
} as const

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

/** The latest attempts across every twister — the "what have I been doing" part of the journey. */
export default function RecentAttempts() {
  const { session } = useAuth()
  const q = useQuery({
    queryKey: ['recent-attempts', session?.user.id],
    queryFn: () => api.recentAttempts(1),
    enabled: !!session,
  })
  return (
    <section aria-labelledby="recent-h">
      <h2 id="recent-h" className="mb-3 text-2xl font-bold">
        Recent attempts
      </h2>
      {q.isPending ? (
        <div className="space-y-2" aria-busy aria-label="Loading attempts">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-2xl" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState
          compact
          title="Couldn’t load your attempts"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.results.length === 0 ? (
        <EmptyState
          title="No attempts yet"
          hint="Your first twister will show up here."
          action={
            <Button asChild>
              <Link to="/twisters">Start practising</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {q.data.results.slice(0, SHOWN).map((a) => (
            <li key={a.id}>
              <Card
                asChild
                variant="glass"
                className="rounded-2xl px-4 py-3 transition-colors hover:border-primary/60"
              >
                <Link
                  to="/twisters/$slug"
                  params={{ slug: a.twister }}
                  className="flex items-center gap-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="font-display text-2xl font-extrabold tabular-nums">
                    {Math.round(a.score)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {a.twister.replace(/-/g, ' ')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {KIND_LABEL[a.kind]} · {Math.round(a.wpm)} wpm ·{' '}
                      {when(a.created_at)}
                    </span>
                  </span>
                  {a.is_personal_best && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-2 py-0.5 text-xs font-semibold">
                      <Trophy className="size-3" aria-hidden />
                      Best
                    </span>
                  )}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
