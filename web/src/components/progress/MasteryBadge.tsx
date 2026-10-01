import { BadgeCheck, Repeat, Sparkles, Target } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import type { MasteryState } from '#/lib/api'

type BadgeVariant = NonNullable<Parameters<typeof Badge>[0]['variant']>

/** Every state carries an icon and a word; colour only reinforces it. */
export const MASTERY: Record<
  MasteryState,
  { label: string; Icon: LucideIcon; variant: BadgeVariant }
> = {
  new: { label: 'New', Icon: Sparkles, variant: 'outline' },
  practising: { label: 'Practising', Icon: Repeat, variant: 'cyan' },
  almost: { label: 'Almost there', Icon: Target, variant: 'pink' },
  mastered: { label: 'Mastered', Icon: BadgeCheck, variant: 'lime' },
}

/** Renders nothing for guests (`mastery` is null for them). */
export function MasteryBadge({ state }: { state: MasteryState | null }) {
  if (!state) return null
  const { label, Icon, variant } = MASTERY[state]
  return (
    <Badge variant={variant} className="gap-1">
      <Icon className="size-3" aria-hidden />
      {label}
    </Badge>
  )
}
