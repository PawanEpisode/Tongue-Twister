import { Lock } from 'lucide-react'
import { useRouterState } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { useGate } from '#/lib/gate/useGate'

/** Under a guest's preview list: says how much more there is and opens the sign-in sheet on intent. */
export default function UnlockPanel({
  total,
  shown,
  noMatch = false,
}: {
  total: number
  shown: number
  noMatch?: boolean
}) {
  const { request } = useGate()
  const here = useRouterState({ select: (s) => s.location.href })
  const more = Math.max(0, total - shown)
  return (
    <div className="glass mt-8 flex flex-col items-center gap-3 rounded-3xl p-8 text-center">
      <Lock className="size-6 text-brand" aria-hidden />
      <p className="font-display text-2xl font-extrabold">
        {noMatch
          ? 'Nothing in the preview matches'
          : more > 0
            ? `+${more.toLocaleString('en-US')} more twisters inside`
            : 'The full library is free with an account'}
      </p>
      <p className="max-w-md text-sm text-muted-foreground">
        {noMatch
          ? `Search and filter all ${total.toLocaleString('en-US')} twisters by level, sound family and origin once you sign in.`
          : 'Every level and sound family, with search, filters and your own progress. Free, no card.'}
      </p>
      <Button
        onClick={() => request({ intent: 'locked_filter', returnTo: here })}
      >
        Unlock all twisters
      </Button>
    </div>
  )
}
