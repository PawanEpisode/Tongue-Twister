import { Link } from '@tanstack/react-router'
import { Flame } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import type { Summary } from '#/lib/api'
import { atRiskCopy } from '#/lib/progress/streak'

/** The evening nudge. Shown only while a live streak is at risk; calm wording, one clear next step. */
export function StreakBanner({
  summary,
  twisterSlug,
}: {
  summary: Pick<Summary, 'streak_at_risk' | 'current_streak' | 'streak_freezes'>
  /** A twister to jump straight into; falls back to Browse. */
  twisterSlug?: string
}) {
  if (!summary.streak_at_risk) return null
  return (
    <Card
      variant="glass"
      className="flex flex-wrap items-center gap-3 rounded-2xl border-pink/40 px-5 py-3"
    >
      <Flame className="size-5 shrink-0 text-pink" aria-hidden />
      <p className="min-w-0 flex-1 text-sm">
        {atRiskCopy(summary.current_streak, summary.streak_freezes)}
      </p>
      <Button asChild size="sm" className="pointer-coarse:min-h-11">
        {twisterSlug ? (
          <Link to="/twisters/$slug" params={{ slug: twisterSlug }}>
            Practise now
          </Link>
        ) : (
          <Link to="/twisters">Pick a twister</Link>
        )}
      </Button>
    </Card>
  )
}
