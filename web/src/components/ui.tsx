import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import type { Twister } from '#/lib/api'
import { Badge } from '#/components/ui/badge'
import { Card } from '#/components/ui/card'

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
      <Card
        asChild
        variant="glass"
        className="group flex h-50 flex-col rounded-2xl p-5 transition-colors hover:border-primary/60"
      >
        <Link to="/twisters/$slug" params={{ slug: t.slug }}>
          <div className="mb-3 flex items-center justify-between">
            <DifficultyBadge level={t.difficulty} />
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
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
              <span className="text-lime">Best {t.best_score}</span>
            ) : (
              <span className="text-brand group-hover:underline">Try it →</span>
            )}
          </div>
        </Link>
      </Card>
    </motion.div>
  )
}
