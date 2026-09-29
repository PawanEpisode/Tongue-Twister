import Lottie from '#/components/ClientLottie'
import confetti from 'canvas-confetti'
import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useEffect } from 'react'
import success from '#/assets/lottie/success.json'

function grade(score: number) {
  if (score >= 95) return { label: 'Tongue Titan!', emoji: '🏆' }
  if (score >= 80) return { label: 'Smooth talker', emoji: '🔥' }
  if (score >= 60) return { label: 'Getting there', emoji: '💪' }
  return { label: 'Tangled — try again', emoji: '🌀' }
}

export default function ResultCard({
  score,
  accuracy,
  wpm,
  xp,
  personalBest,
  levelUp,
  onRetry,
  onNext,
}: {
  score: number
  accuracy: number
  wpm: number
  xp?: number
  personalBest?: boolean
  levelUp?: boolean
  onRetry: () => void
  onNext: () => void
}) {
  const mv = useMotionValue(0)
  const shown = useTransform(mv, (v) => Math.round(v))
  const g = grade(score)
  useEffect(() => {
    const c = animate(mv, score, { duration: 1.4, ease: 'easeOut' })
    if (score >= 80) {
      const end = Date.now() + 900
      const tick = () => {
        confetti({
          particleCount: 5,
          angle: 60,
          spread: 70,
          origin: { x: 0, y: 0.7 },
          colors: ['#8b6bff', '#f973c0', '#38d9f5', '#a3f75b'],
        })
        confetti({
          particleCount: 5,
          angle: 120,
          spread: 70,
          origin: { x: 1, y: 0.7 },
          colors: ['#8b6bff', '#f973c0', '#38d9f5', '#a3f75b'],
        })
        if (Date.now() < end) requestAnimationFrame(tick)
      }
      tick()
    }
    return () => c.stop()
  }, [score, mv])

  const R = 70,
    C = 2 * Math.PI * R
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass mx-auto max-w-md rounded-3xl p-8 text-center"
    >
      <div className="relative mx-auto h-44 w-44">
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
          <circle
            cx="80"
            cy="80"
            r={R}
            stroke="#2a2650"
            strokeWidth="12"
            fill="none"
          />
          <motion.circle
            cx="80"
            cy="80"
            r={R}
            stroke="url(#g)"
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={C}
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C * (1 - score / 100) }}
            transition={{ duration: 1.4, ease: 'easeOut' }}
          />
          <defs>
            <linearGradient id="g">
              <stop offset="0" stopColor="#8b6bff" />
              <stop offset="1" stopColor="#f973c0" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div>
            <motion.span className="font-display text-5xl font-extrabold">
              {shown}
            </motion.span>
            <div className="text-xs text-white/50">/ 100</div>
          </div>
        </div>
        {score >= 80 && (
          <Lottie
            animationData={success}
            loop={false}
            className="absolute -right-3 -top-3 h-16 w-16"
          />
        )}
      </div>
      <h2 className="mt-4 text-2xl font-bold">
        {g.emoji} {g.label}
      </h2>
      {personalBest && (
        <p className="mt-1 text-sm font-semibold text-lime">
          New personal best!
        </p>
      )}
      {levelUp && (
        <p className="mt-1 text-sm font-semibold text-pink">Level up! 🎉</p>
      )}
      <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
        <Stat k="Accuracy" v={`${Math.round(accuracy * 100)}%`} />
        <Stat k="Speed" v={`${Math.round(wpm)} wpm`} />
        <Stat k="XP" v={xp != null ? `+${xp}` : '—'} />
      </div>
      <div className="mt-6 flex gap-3">
        <button
          onClick={onRetry}
          className="flex-1 rounded-xl border border-line py-3 font-semibold hover:border-brand"
        >
          Retry
        </button>
        <button
          onClick={onNext}
          className="flex-1 rounded-xl bg-brand py-3 font-semibold hover:opacity-90"
        >
          Next twister →
        </button>
      </div>
    </motion.div>
  )
}
const Stat = ({ k, v }: { k: string; v: string }) => (
  <div className="rounded-xl bg-ink/60 p-3">
    <div className="text-xs text-white/40">{k}</div>
    <div className="font-semibold">{v}</div>
  </div>
)
