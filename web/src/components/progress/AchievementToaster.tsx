import { Link } from '@tanstack/react-router'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { useFlag } from '#/lib/flags'
import { useAchievementToasts } from '#/lib/progress/useAchievementToasts'
import type { UnlockedAchievement } from '#/lib/api'
import { readAccentColors } from '#/lib/theme'
import { achievementIcon } from './achievementIcons'
import { TierBadge } from './AchievementTier'

const VISIBLE_MS = 7_000

/** A short, contained burst; skipped entirely when the viewer prefers reduced motion. */
function celebrate() {
  void import('canvas-confetti').then(({ default: confetti }) =>
    confetti({
      particleCount: 40,
      spread: 60,
      origin: { x: 0.9, y: 0.95 },
      colors: readAccentColors(),
    }),
  )
}

function Toast({
  a,
  waiting,
  onClose,
}: {
  a: UnlockedAchievement
  waiting: number
  onClose: () => void
}) {
  const Icon = achievementIcon(a.icon)
  // Auto-dismiss, but never while someone is reading or interacting (WCAG 2.2.1).
  const [held, setHeld] = useState(false)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (held) return
    const t = setTimeout(() => close.current(), VISIBLE_MS)
    return () => clearTimeout(t)
  }, [held])

  return (
    <div
      className="glass pointer-events-auto flex items-start gap-3 rounded-2xl p-4 shadow-lg"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/20 text-brand">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Achievement unlocked
        </p>
        <p className="font-display text-lg font-bold leading-tight">{a.name}</p>
        <p className="text-sm text-muted-foreground">{a.description}</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <TierBadge tier={a.tier} />
          <span className="font-semibold text-lime">+{a.xp_reward} XP</span>
          <Link
            to="/stats"
            className="underline underline-offset-2"
            onClick={onClose}
          >
            See all
          </Link>
          {waiting > 0 && (
            <span className="text-muted-foreground">
              · {waiting} more to show
            </span>
          )}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        aria-label="Dismiss"
        className="size-11 shrink-0 rounded-full p-0"
        onClick={onClose}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  )
}

/** Mounted once in the root. The live region stays in the page so screen readers announce each new toast. */
export function AchievementToaster() {
  const enabled = useFlag('achievements')
  const reduce = useReducedMotion()
  const { current, waiting, close } = useAchievementToasts()
  const celebrated = useRef<string | null>(null)

  useEffect(() => {
    if (!current || reduce || celebrated.current === current.code) return
    celebrated.current = current.code
    celebrate()
  }, [current, reduce])

  if (!enabled) return null
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 sm:left-auto sm:w-96"
    >
      <AnimatePresence mode="wait">
        {current && (
          <m.div
            key={current.code}
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
            transition={{ duration: reduce ? 0 : 0.25 }}
          >
            <Toast
              a={current}
              waiting={waiting}
              onClose={() => close(current.code)}
            />
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
