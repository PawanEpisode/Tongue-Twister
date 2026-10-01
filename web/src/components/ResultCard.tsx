import Lottie from '#/components/ClientLottie'
import confetti from 'canvas-confetti'
import { BicepsFlexed, Flame, PartyPopper, Tornado, Trophy } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { m } from 'motion/react'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import success from '#/assets/lottie/success.json'
import { ScoreRing, StatTile } from '#/components/ScoreCardParts'
import ScoreCardShare from '#/components/ScoreCardShare'
import { achievementIcon } from '#/components/progress/achievementIcons'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import type { UnlockedAchievement } from '#/lib/api'
import { readAccentColors } from '#/lib/theme'

function grade(score: number): { label: string; Icon: LucideIcon } {
  if (score >= 95) return { label: 'Tongue Titan!', Icon: Trophy }
  if (score >= 80) return { label: 'Smooth talker', Icon: Flame }
  if (score >= 60) return { label: 'Getting there', Icon: BicepsFlexed }
  return { label: 'Tangled — try again', Icon: Tornado }
}

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
  /** Detail below the stats, e.g. the word-by-word view. */
  children?: ReactNode
  onRetry: () => void
  onNext: () => void
}) {
  const g = grade(score)
  useEffect(() => {
    if (score < 80) return
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
  }, [score])

  return (
    <m.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
    >
      <Card
        variant="glass"
        className="mx-auto max-w-md rounded-3xl p-8 text-center"
      >
        <ScoreRing score={score} animated>
          {score >= 80 && (
            <Lottie
              animationData={success}
              loop={false}
              className="absolute -right-3 -top-3 h-16 w-16"
            />
          )}
        </ScoreRing>
        <h2 className="mt-4 flex items-center justify-center gap-2 text-2xl font-bold">
          <g.Icon className="size-6 shrink-0" aria-hidden />
          {g.label}
        </h2>
        {personalBest && (
          <p className="mt-1 text-sm font-semibold text-lime">
            New personal best!
          </p>
        )}
        {levelUp && (
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm font-semibold text-pink">
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
                  className="flex items-center justify-center gap-1.5 font-semibold text-cyan"
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
        <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
          <StatTile k="Accuracy" v={`${Math.round(accuracy * 100)}%`} />
          <StatTile k="Speed" v={`${Math.round(wpm)} wpm`} />
          <StatTile k="XP" v={xp != null ? `+${xp}` : '—'} />
        </div>
        {notice && (
          <p role="status" className="mt-4 text-xs text-muted-foreground">
            {notice}
          </p>
        )}
        {children}
        <ScoreCardShare attemptId={attemptId} />
        <div className="mt-6 flex gap-3">
          <Button variant="outline" className="flex-1 py-3" onClick={onRetry}>
            Retry
          </Button>
          <Button className="flex-1 py-3" onClick={onNext}>
            Next twister →
          </Button>
        </div>
      </Card>
    </m.div>
  )
}
