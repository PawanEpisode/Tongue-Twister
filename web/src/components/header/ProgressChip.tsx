import { Link } from '@tanstack/react-router'
import { Flame } from 'lucide-react'
import { useSummary } from '#/lib/progress/useSummary'
import { useMe } from '#/lib/useMe'
import { cn } from '#/lib/utils'

/** Streak, level, and XP. This is the way into Stats. */
export function ProgressChip() {
  const { data: me } = useMe()
  const { data: summary } = useSummary()
  if (!me) return null
  const streak = summary?.current_streak ?? me.current_streak
  const level = summary?.level ?? me.level
  const xp = summary?.xp ?? me.xp
  const hot = streak > 0
  return (
    <Link
      to="/stats"
      aria-label={`${streak}-day streak, level ${level}, ${xp} XP. Open your stats.`}
      className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/90 py-1 pr-2 pl-1 text-xs font-semibold shadow-sm transition-colors hover:border-pink/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none sm:gap-2 sm:pr-2.5 pointer-coarse:min-h-11"
    >
      <span
        aria-hidden
        className={cn(
          'grid size-6 shrink-0 place-items-center rounded-full',
          hot ? 'bg-pink/15 text-pink' : 'bg-muted text-muted-foreground',
        )}
      >
        <Flame className="size-3.5" />
      </span>
      <span className="tabular-nums text-foreground">{streak}</span>
      <span className="hidden font-medium text-muted-foreground sm:inline">
        {streak === 1 ? 'day' : 'days'}
      </span>
      <span className="hidden h-3 w-px bg-border sm:block" aria-hidden />
      <span className="hidden tabular-nums text-muted-foreground sm:inline">
        Lv {level}
      </span>
      <span className="hidden rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-brand sm:inline">
        {xp} XP
      </span>
    </Link>
  )
}
