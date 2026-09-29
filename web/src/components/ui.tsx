import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import type { Twister } from '#/lib/api'

const DIFF = {
  1: { label: 'Easy', cls: 'bg-lime/15 text-lime border-lime/30' },
  2: { label: 'Medium', cls: 'bg-cyan/15 text-cyan border-cyan/30' },
  3: { label: 'Hard', cls: 'bg-pink/15 text-pink border-pink/30' },
  4: { label: 'Insane', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
} as const

export function DifficultyBadge({ level }: { level: 1 | 2 | 3 | 4 }) {
  const d = DIFF[level]
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${d.cls}`}
    >
      {d.label}
    </span>
  )
}

export function TwisterCard({ t, i = 0 }: { t: Twister; i?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 8) * 0.04 }}
      whileHover={{ y: -4, scale: 1.01 }}
    >
      <Link
        to="/twisters/$slug"
        params={{ slug: t.slug }}
        className="glass group block h-full rounded-2xl p-5 transition-colors hover:border-brand/60"
      >
        <div className="mb-3 flex items-center justify-between">
          <DifficultyBadge level={t.difficulty} />
          <span className="text-xs uppercase tracking-wide text-white/40">
            {t.origin}
          </span>
        </div>
        <p className="font-display text-lg leading-snug text-white/95">
          {t.text}
        </p>
        <div className="mt-4 flex items-center justify-between text-xs text-white/50">
          <span>{t.word_count} words</span>
          {t.best_score != null ? (
            <span className="text-lime">Best {t.best_score}</span>
          ) : (
            <span className="text-brand group-hover:underline">Try it →</span>
          )}
        </div>
      </Link>
    </motion.div>
  )
}
