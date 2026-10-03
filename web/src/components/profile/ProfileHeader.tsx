import { Flame, Sparkles } from 'lucide-react'
import { Skeleton } from '#/components/feedback'
import { Card } from '#/components/ui/card'
import type { Profile } from '#/lib/api'
import { useIdentity } from '#/lib/profile/useIdentity'
import { useSummary } from '#/lib/progress/useSummary'
import Avatar from './Avatar'
import DailyGoalRing from './DailyGoalRing'
import ProfileEditDialog from './ProfileEditDialog'

/** Who you are and where you stand: avatar, name, level with XP progress, and streak. */
export default function ProfileHeader({
  me,
  locked,
}: {
  me: Profile
  locked: boolean
}) {
  const identity = useIdentity()
  const summary = useSummary().data
  if (!identity) return null
  const fraction = summary
    ? Math.min(
        1,
        summary.xp_for_next_level > 0
          ? summary.xp_in_level / summary.xp_for_next_level
          : 0,
      )
    : 0
  return (
    <Card variant="glass" className="rounded-3xl p-5 sm:p-7">
      <div className="flex flex-wrap items-center gap-4 sm:gap-6">
        <span className="size-20 shrink-0 text-4xl sm:size-24 sm:text-5xl">
          <Avatar view={identity.avatar} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl font-extrabold sm:text-3xl">
            {identity.name}
          </h1>
          {identity.email && (
            <p className="truncate text-sm text-muted-foreground">
              {identity.email}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1 font-semibold">
              <Sparkles className="size-4" aria-hidden />
              Level {me.level}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1">
              <Flame className="size-4 text-pink" aria-hidden />
              {me.current_streak}-day streak
            </span>
            {summary && <DailyGoalRing goal={summary.daily_goal} />}
          </div>
        </div>
        <ProfileEditDialog me={me} disabled={locked} />
      </div>
      <div className="mt-5">
        {summary ? (
          <>
            <div
              role="progressbar"
              aria-label="Progress to next level"
              aria-valuemin={0}
              aria-valuemax={summary.xp_for_next_level}
              aria-valuenow={summary.xp_in_level}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${fraction * 100}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
              {summary.xp_in_level} / {summary.xp_for_next_level} XP to level{' '}
              {summary.level + 1} · {summary.xp.toLocaleString()} XP total
            </p>
          </>
        ) : (
          <Skeleton className="h-2 w-full" />
        )}
      </div>
    </Card>
  )
}
