import {
  Link,
  createFileRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { BarChart3, Flame, Trophy } from 'lucide-react'
import { PracticeSkeleton } from '#/components/feedback'
import { StatsView } from '#/components/progress/StatsView'
import { Button } from '#/components/ui/button'
import type { StatsMode, StatsRange } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import {
  DEFAULT_RANGE,
  parseMode,
  parseRange,
} from '#/lib/progress/statsParams'
import { seo } from '#/lib/seo'

type Search = { range?: StatsRange; mode?: StatsMode }

export const Route = createFileRoute('/stats')({
  head: () =>
    seo({
      title: 'Your progress | Twister',
      description: 'Your scores, streaks, weak words and achievements.',
      path: '/stats',
      noindex: true,
    }),
  validateSearch: (raw: Record<string, unknown>): Search => {
    const mode = parseMode(raw.mode)
    return {
      ...(raw.range !== undefined && { range: parseRange(raw.range) }),
      ...(mode && { mode }),
    }
  },
  component: StatsPage,
})

function StatsPage() {
  const { session, loading } = useAuth()
  const here = useRouterState({ select: (s) => s.location.href })
  const { range = DEFAULT_RANGE, mode } = Route.useSearch()
  const nav = useNavigate({ from: Route.fullPath })

  if (loading) return <PracticeSkeleton />
  if (!session)
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-bold">Your progress</h1>
        <p className="mt-2 text-muted-foreground">
          Sign in to keep your scores, streaks and achievements.
        </p>
        <ul className="mx-auto mt-4 max-w-xs space-y-2 text-left text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <BarChart3 className="size-4 text-brand" aria-hidden />
            See how your scores and speed change
          </li>
          <li className="flex items-center gap-2">
            <Flame className="size-4 text-pink" aria-hidden />
            Build a streak, with freezes for busy days
          </li>
          <li className="flex items-center gap-2">
            <Trophy className="size-4 text-cyan" aria-hidden />
            Unlock achievements as you improve
          </li>
        </ul>
        <Button asChild className="mt-6 px-6 py-3">
          <Link to="/login" search={{ redirect: here }}>
            Sign in
          </Link>
        </Button>
      </div>
    )

  return (
    <StatsView
      range={range}
      mode={mode}
      onChange={(next) =>
        void nav({
          // `mode: undefined` means "all modes" and drops out of the URL.
          search: (p) => ({ ...p, ...next }),
          replace: true,
        })
      }
    />
  )
}
