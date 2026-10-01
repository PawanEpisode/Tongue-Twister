import { Link } from '@tanstack/react-router'
import { Trophy } from 'lucide-react'
import { motion } from 'motion/react'
import type { Twister } from '#/lib/api'
import { Badge } from '#/components/ui/badge'
import { Card } from '#/components/ui/card'
import { FavoriteButton } from '#/components/progress/FavoriteButton'
import { MasteryBadge } from '#/components/progress/MasteryBadge'

const DIFF = {
  1: { label: 'Easy', variant: 'lime' },
  2: { label: 'Medium', variant: 'cyan' },
  3: { label: 'Hard', variant: 'pink' },
  4: { label: 'Insane', variant: 'destructive' },
} as const

export function DifficultyBadge({ level }: { level: 1 | 2 | 3 | 4 }) {
  const d = DIFF[level]
  return <Badge variant={d.variant}>{d.label}</Badge>
}

export function TwisterCard({ t, i = 0 }: { t: Twister; i?: number }) {
  return (
    <motion.div
      className="h-full"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 8) * 0.04 }}
      whileHover={{ y: -4, scale: 1.01 }}
    >
      {/* The star is a sibling of the link, not inside it: a button can't live in an anchor. */}
      <Card
        variant="glass"
        className="group relative h-50 rounded-2xl transition-colors focus-within:border-primary/60 hover:border-primary/60"
      >
        <Link
          to="/twisters/$slug"
          params={{ slug: t.slug }}
          className="flex h-full flex-col rounded-2xl p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <div className="mb-3 flex items-center gap-2 pr-9">
            <DifficultyBadge level={t.difficulty} />
            <MasteryBadge state={t.mastery} />
            <span className="ml-auto text-xs uppercase tracking-wide text-muted-foreground">
              {t.origin}
            </span>
          </div>
          {/* Fixed 3-line preview: every card is the same height; the full text is on the practice screen. */}
          <p className="line-clamp-3 h-18 font-display text-lg leading-6 text-foreground">
            {t.text}
          </p>
          <div className="mt-auto flex items-center justify-between pt-4 text-xs text-muted-foreground">
            <span>{t.word_count} words</span>
            {t.best_score != null ? (
              <Badge variant="lime" className="gap-1">
                <Trophy className="size-3" aria-hidden />
                Best {t.best_score}
              </Badge>
            ) : (
              <span className="text-brand group-hover:underline">Try it →</span>
            )}
          </div>
        </Link>
        <FavoriteButton twister={t} className="absolute right-1.5 top-1.5" />
      </Card>
    </motion.div>
  )
}
