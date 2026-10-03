import { Check, Target } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { DailyGoal } from '#/lib/api'

const R = 18
const C = 2 * Math.PI * R

/** Today's goal as a ring. With no goal set it is a quiet prompt to set one, not an empty ring. */
export default function DailyGoalRing({ goal }: { goal?: DailyGoal }) {
  if (!goal || goal.target === 0)
    return (
      <Link
        to="/account"
        hash="practice"
        className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Target className="size-4" aria-hidden />
        Set a daily goal
      </Link>
    )
  const fraction = Math.min(1, goal.done / goal.target)
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full bg-muted py-1 pr-3 pl-1.5 text-sm"
      role="img"
      aria-label={
        goal.met
          ? `Daily goal met: ${goal.done} of ${goal.target} attempts`
          : `Daily goal: ${goal.done} of ${goal.target} attempts`
      }
    >
      <svg viewBox="0 0 44 44" className="size-8 -rotate-90" aria-hidden>
        <circle
          cx="22"
          cy="22"
          r={R}
          fill="none"
          strokeWidth="5"
          className="stroke-border"
        />
        <circle
          cx="22"
          cy="22"
          r={R}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - fraction)}
          className={`transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none ${goal.met ? 'stroke-lime' : 'stroke-primary'}`}
        />
      </svg>
      <span className="tabular-nums">
        {goal.met ? (
          <span className="inline-flex items-center gap-1 font-semibold text-lime">
            <Check className="size-4" aria-hidden />
            Goal met
          </span>
        ) : (
          <>
            {goal.done}/{goal.target} today
          </>
        )}
      </span>
    </div>
  )
}
