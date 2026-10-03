import confetti from 'canvas-confetti'
import { Link } from '@tanstack/react-router'
import { PartyPopper } from 'lucide-react'
import { m } from 'motion/react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import ScoreBar from '#/components/results/ScoreBar'
import ScoreCardShare from '#/components/ScoreCardShare'
import { useCelebrations } from '#/lib/preferences'
import { achievementIcon } from '#/components/progress/achievementIcons'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import type { UnlockedAchievement } from '#/lib/api'
import { headlineFor } from '#/lib/speak/coaching'
import { tallyRows } from '#/lib/speak/display'
import type { WordRow } from '#/lib/speak/display'
import { readAccentColors } from '#/lib/theme'

/** One quiet stat in the row under the score bar. */
const Stat = ({ k, v }: { k: string; v: string }) => (
  <div>
    <span className="text-muted-foreground">{k}</span>{' '}
    <b className="font-semibold">{v}</b>
  </div>
)

export default function ResultCard({
  score,
  accuracy,
  wpm,
  xp,
  personalBest,
  levelUp,
  unlocked,
  notice,
  attemptId,
  rows,
  drill = false,
  children,
  onRetry,
  onNext,
}: {
  score: number
  accuracy: number
  wpm: number
  xp?: number
  personalBest?: boolean
  levelUp?: boolean
  /** Achievements this attempt just unlocked (the toaster announces them too). */
  unlocked?: UnlockedAchievement[]
  /** A line of context under the score (offline, capped, estimated…). */
  notice?: string
  /** The saved attempt this result came from; enables "Share score card" for signed-in users. */
  attemptId?: number | null
  /** The scored words; drives the score bar and the one-line story. */
  rows?: readonly WordRow[]
  /** Offer the weak-words drill (needs a saved attempt and at least one slip). */
  drill?: boolean
  /** Detail below the stats, e.g. the word-by-word view. */
  children?: ReactNode
  onRetry: () => void
  onNext: () => void
}) {
  const tally = rows ? tallyRows(rows) : null
  const head = headlineFor(
    score,
    tally ?? { correct: 0, near: 0, wrong: 0, missed: 0, extra: 0 },
  )
  const perfect = Math.round(accuracy * 100) === 100
  const celebrations = useCelebrations()
  useEffect(() => {
    if (score < 80 || !celebrations) return
    const end = Date.now() + 900
    const tick = () => {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 70,
        origin: { x: 0, y: 0.7 },
        colors: readAccentColors(),
      })
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 70,
        origin: { x: 1, y: 0.7 },
        colors: readAccentColors(),
      })
      if (Date.now() < end) requestAnimationFrame(tick)
    }
    tick()
  }, [score, celebrations])

  return (
    <m.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <Card
        variant="glass"
        className="mx-auto max-w-md rounded-3xl p-6 text-left sm:p-8"
      >
        <div className="flex items-end gap-3">
          <span
            aria-label={`Score ${score} out of 100`}
            className="font-display text-7xl font-extrabold leading-none text-primary"
          >
            {score}
          </span>
          <span className="pb-1 text-sm text-muted-foreground">
            out of 100
            {personalBest && (
              <b className="block font-semibold text-lime">New personal best</b>
            )}
          </span>
        </div>
        <h2 className="mt-5 font-display text-2xl font-bold">{head.title}</h2>
        {head.story && (
          <p className="mt-1 italic text-muted-foreground">{head.story}</p>
        )}
        {levelUp && (
          <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-pink">
            <PartyPopper className="size-4" aria-hidden />
            Level up!
          </p>
        )}
        {unlocked && unlocked.length > 0 && (
          <ul
            aria-label="Achievements unlocked"
            className="mt-3 space-y-1 text-sm"
          >
            {unlocked.map((a) => {
              const Icon = achievementIcon(a.icon)
              return (
                <li
                  key={a.code}
                  className="flex items-center gap-1.5 font-semibold text-cyan"
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  Unlocked: {a.name}
                  <span className="font-normal text-muted-foreground">
                    +{a.xp_reward} XP
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {tally && (
          <div className="mt-5">
            <ScoreBar tally={tally} />
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Stat k="Accuracy" v={`${Math.round(accuracy * 100)}%`} />
          <Stat k="Speed" v={`${Math.round(wpm)} wpm`} />
          <Stat k="XP" v={xp != null ? `+${xp}` : '—'} />
        </div>
        {notice && (
          <p role="status" className="mt-4 text-xs text-muted-foreground">
            {notice}
          </p>
        )}
        {children}
        <ScoreCardShare attemptId={attemptId} />
        <div className="mt-6 space-y-3">
          {drill && (
            <Button asChild className="w-full py-3">
              <Link to="/practice" search={{ drill: 1 }}>
                Drill your weak words
              </Link>
            </Button>
          )}
          <div className="flex gap-3">
            {!perfect && (
              <Button
                variant="outline"
                className="flex-1 py-3"
                onClick={onRetry}
              >
                Retry
              </Button>
            )}
            <Button
              variant={drill ? 'outline' : 'default'}
              className="flex-1 py-3"
              onClick={onNext}
            >
              Next twister
            </Button>
          </div>
        </div>
      </Card>
    </m.div>
  )
}
