import { Lock } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Card } from '#/components/ui/card'
import type { AchievementView } from '#/lib/api'
import { formatPercent } from '#/lib/progress/format'
import { cn } from '#/lib/utils'
import { achievementIcon } from './achievementIcons'
import { TierBadge } from './AchievementTier'

function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={formatPercent(value)}
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div
        className="h-full rounded-full bg-brand"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  )
}

function AchievementCard({ a }: { a: AchievementView }) {
  const unlocked = a.unlocked_at !== null
  const Icon = unlocked ? achievementIcon(a.icon) : Lock
  return (
    <Card
      asChild
      variant="glass"
      className={cn('rounded-2xl p-4', !unlocked && 'opacity-80')}
    >
      <li>
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-full',
              unlocked
                ? 'bg-primary/20 text-brand'
                : 'bg-muted text-muted-foreground',
            )}
          >
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-base font-bold leading-tight">
              {a.name}
            </h3>
            <p className="text-sm text-muted-foreground">{a.description}</p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <TierBadge tier={a.tier} />
              <Badge variant={unlocked ? 'lime' : 'outline'}>
                {unlocked ? 'Unlocked' : 'Locked'}
              </Badge>
              <span className="text-muted-foreground">+{a.xp_reward} XP</span>
            </p>
            {!unlocked && a.progress !== null && (
              <Progress
                value={a.progress}
                label={`Progress toward ${a.name}`}
              />
            )}
          </div>
        </div>
      </li>
    </Card>
  )
}

/** Unlocked first (newest first), then locked in catalogue order. Locked secrets arrive already masked. */
export function AchievementGrid({ items }: { items: AchievementView[] }) {
  const unlocked = items
    .filter((a) => a.unlocked_at)
    .sort((a, b) => (b.unlocked_at ?? '').localeCompare(a.unlocked_at ?? ''))
  const locked = items.filter((a) => !a.unlocked_at)
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {[...unlocked, ...locked].map((a) => (
        <AchievementCard key={a.code} a={a} />
      ))}
    </ul>
  )
}
