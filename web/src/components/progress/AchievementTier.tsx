import { Badge } from '#/components/ui/badge'
import type { AchievementTier } from '#/lib/api'

const TIERS: Record<
  AchievementTier,
  { label: string; variant: 'pink' | 'cyan' | 'lime' }
> = {
  bronze: { label: 'Bronze', variant: 'pink' },
  silver: { label: 'Silver', variant: 'cyan' },
  gold: { label: 'Gold', variant: 'lime' },
}

/** The tier is always spelled out; the colour is decoration. */
export function TierBadge({ tier }: { tier: AchievementTier }) {
  const t = TIERS[tier]
  return <Badge variant={t.variant}>{t.label}</Badge>
}
