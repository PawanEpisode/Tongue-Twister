import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BadgeCheck, Flame, Snowflake, Trophy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ErrorState, Skeleton } from '#/components/feedback'
import { Card } from '#/components/ui/card'
import { api } from '#/lib/api'
import type { Summary } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { useFlag } from '#/lib/flags'
import { freezeCopy, milestoneCopy, streakLabel } from '#/lib/progress/streak'
import { useSummary } from '#/lib/progress/useSummary'
import { guestQueue } from '#/lib/syncQueue'
import { cn } from '#/lib/utils'

const STREAK_FREEZE_MAX = 2

function Tile({
  Icon,
  iconClass,
  label,
  value,
  children,
}: {
  Icon: LucideIcon
  iconClass: string
  label: string
  value: ReactNode
  children?: ReactNode
}) {
  return (
    <Card
      asChild
      variant="glass"
      className="block rounded-2xl p-4 transition-colors hover:border-primary/60"
    >
      <Link
        to="/stats"
        className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Icon className={cn('size-4', iconClass)} aria-hidden />
          {label}
        </span>
        <span className="mt-1 block font-display text-3xl font-extrabold">
          {value}
        </span>
        {children}
      </Link>
    </Card>
  )
}

function Bar({ fraction }: { fraction: number }) {
  return (
    <span
      aria-hidden
      className="mt-2 block h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <span
        className="block h-full rounded-full bg-brand"
        style={{ width: `${Math.round(Math.min(1, fraction) * 100)}%` }}
      />
    </span>
  )
}

const Sub = ({ children }: { children: ReactNode }) => (
  <span className="mt-1 block text-xs text-muted-foreground">{children}</span>
)

function FreezePips({ count }: { count: number }) {
  return (
    <span
      className="ml-auto inline-flex gap-0.5"
      role="img"
      aria-label={`${count} of ${STREAK_FREEZE_MAX} streak freezes banked`}
    >
      {Array.from({ length: STREAK_FREEZE_MAX }, (_, i) => (
        <Snowflake
          key={i}
          className={cn('size-4', i < count ? 'text-cyan' : 'text-muted')}
          aria-hidden
        />
      ))}
    </span>
  )
}

function StripSkeleton({ tiles }: { tiles: number }) {
  return (
    <div
      className={cn('grid gap-3', tiles === 3 && 'sm:grid-cols-3')}
      aria-busy
      aria-label="Loading your progress"
    >
      {Array.from({ length: tiles }, (_, i) => (
        <Card key={i} variant="glass" className="rounded-2xl p-4" aria-hidden>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-8 w-20" />
          <Skeleton className="mt-3 h-2 w-full" />
        </Card>
      ))}
    </div>
  )
}

function SignedInStrip({
  summary,
  showAchievements,
}: {
  summary: Summary
  showAchievements: boolean
}) {
  const fresh = summary.mastered === 0 && summary.current_streak === 0
  return (
    <div
      className={cn(
        'grid gap-3',
        showAchievements && 'sm:grid-cols-3',
        !showAchievements && 'sm:grid-cols-2',
      )}
    >
      <Tile
        Icon={BadgeCheck}
        iconClass="text-lime"
        label="Mastered"
        value={
          <>
            {summary.mastered}
            <span className="text-lg font-semibold text-muted-foreground">
              /{summary.total}
            </span>
          </>
        }
      >
        <Bar fraction={summary.total ? summary.mastered / summary.total : 0} />
        <Sub>
          {fresh
            ? 'Say your first twister to get started.'
            : 'twisters mastered'}
        </Sub>
      </Tile>
      <Tile
        Icon={Flame}
        iconClass="text-pink"
        label="Streak"
        value={
          <span className="flex items-center gap-2">
            {summary.current_streak}
            <span className="text-lg font-semibold text-muted-foreground">
              {summary.current_streak === 1 ? 'day' : 'days'}
            </span>
            <FreezePips count={summary.streak_freezes} />
          </span>
        }
      >
        <Sub>
          <span className="sr-only">
            {streakLabel(summary.current_streak)}.{' '}
            {freezeCopy(summary.streak_freezes, STREAK_FREEZE_MAX)}{' '}
          </span>
          {summary.practised_today
            ? 'Practised today. Nice.'
            : milestoneCopy(
                summary.current_streak,
                summary.next_streak_milestone,
              )}
        </Sub>
      </Tile>
      {showAchievements && (
        <Tile
          Icon={Trophy}
          iconClass="text-cyan"
          label="Achievements"
          value={
            <>
              {summary.achievements.unlocked}
              <span className="text-lg font-semibold text-muted-foreground">
                /{summary.achievements.total}
              </span>
            </>
          }
        >
          <Bar
            fraction={
              summary.achievements.total
                ? summary.achievements.unlocked / summary.achievements.total
                : 0
            }
          />
          <Sub>unlocked</Sub>
        </Tile>
      )}
    </div>
  )
}

function GuestStrip({
  total,
  showAchievements,
}: {
  total: number | undefined
  showAchievements: boolean
}) {
  const [hasAttempt, setHasAttempt] = useState(false)
  useEffect(() => setHasAttempt(guestQueue.hasAttempts()), [])
  return (
    <div className="space-y-2">
      <div
        className={cn(
          'grid gap-3',
          showAchievements ? 'sm:grid-cols-3' : 'sm:grid-cols-2',
        )}
      >
        <Tile
          Icon={BadgeCheck}
          iconClass="text-lime"
          label="Mastered"
          value={
            <>
              0
              {total != null && (
                <span className="text-lg font-semibold text-muted-foreground">
                  /{total}
                </span>
              )}
            </>
          }
        />
        <Tile
          Icon={Flame}
          iconClass="text-pink"
          label="Streak"
          value={
            <>
              0{' '}
              <span className="text-lg font-semibold text-muted-foreground">
                days
              </span>
            </>
          }
        />
        {showAchievements && (
          <Tile
            Icon={Trophy}
            iconClass="text-cyan"
            label="Achievements"
            value="0"
          />
        )}
      </div>
      {hasAttempt && (
        <p className="text-sm text-muted-foreground">
          <Link
            to="/login"
            search={{ redirect: '/' }}
            className="font-semibold text-foreground underline underline-offset-2"
          >
            Sign in to save your progress
          </Link>{' '}
          — what you’ve done so far comes with you.
        </p>
      )}
    </div>
  )
}

/** Mastered · Streak · Achievements, each a link to /stats. Has a skeleton, an error with retry, and a guest form. */
export function ProgressStrip() {
  const { session, loading } = useAuth()
  const showAchievements = useFlag('achievements')
  const summary = useSummary()
  // Guests see the catalogue size from the public facets call (Browse shares the same cache entry).
  const facets = useQuery({
    queryKey: ['facets', {}],
    queryFn: () => api.facets(),
    enabled: !loading && !session,
  })
  const tiles = showAchievements ? 3 : 2

  if (loading) return <StripSkeleton tiles={tiles} />
  if (!session)
    return (
      <GuestStrip
        total={facets.data?.total}
        showAchievements={showAchievements}
      />
    )
  if (summary.isError)
    return (
      <ErrorState
        compact
        title="Couldn’t load your progress"
        error={summary.error}
        onRetry={() => void summary.refetch()}
      />
    )
  if (!summary.data) return <StripSkeleton tiles={tiles} />
  return (
    <SignedInStrip summary={summary.data} showAchievements={showAchievements} />
  )
}
