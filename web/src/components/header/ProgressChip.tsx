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
      className="inline-flex items-center rounded-full text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:gap-2 sm:border sm:border-border/70 sm:bg-card/90 sm:py-1 sm:pr-2.5 sm:pl-1 sm:shadow-sm sm:transition-colors sm:hover:border-pink/40"
    >
      <span
        className={cn(
          'inline-flex size-11 items-center justify-center gap-0.5 rounded-full text-pink sm:hidden',
          hot ? 'bg-pink/15' : 'bg-muted text-muted-foreground',
        )}
      >
        <Flame className="size-3.5" aria-hidden />
        <span className="text-[11px] font-bold tabular-nums">{streak}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          'hidden size-6 shrink-0 place-items-center rounded-full sm:grid',
          hot ? 'bg-pink/15 text-pink' : 'bg-muted text-muted-foreground',
        )}
      >
        <Flame className="size-3.5" />
      </span>
      <span className="hidden tabular-nums text-foreground sm:inline">
        {streak}
      </span>
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
