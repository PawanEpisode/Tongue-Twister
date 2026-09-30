import { useQuery } from '@tanstack/react-query'
import { api } from '#/lib/api'
import type { Twister } from '#/lib/api'
import { useAuth } from '#/lib/auth'

const W = 120
const H = 32

/** Scores oldest → newest as a tiny accessible line. */
export function Sparkline({ scores }: { scores: number[] }) {
  if (scores.length < 2) return null
  const step = W / (scores.length - 1)
  const points = scores.map(
    (s, i) =>
      `${(i * step).toFixed(1)},${(H - (Math.min(100, Math.max(0, s)) / 100) * H).toFixed(1)}`,
  )
  return (
    <svg
      role="img"
      aria-label={`Last ${scores.length} scores: ${scores.join(', ')}`}
      viewBox={`0 0 ${W} ${H}`}
      className="h-8 w-30 overflow-visible"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="text-brand"
      />
    </svg>
  )
}

/** Best score, attempts, tip and focus sounds. Hidden until there is something to show (PRD 01 H5). */
export default function SidePanel({ twister }: { twister: Twister }) {
  const { session } = useAuth()
  const history = useQuery({
    queryKey: ['history', twister.slug, session?.user.id],
    queryFn: () => api.history(twister.slug),
    enabled: !!session,
  })
  const h = history.data
  const hasHistory = !!h && h.count > 0
  if (!hasHistory && !twister.focus_sounds.length) return null

  const scores = (h?.results ?? []).map((r) => r.score).reverse()
  return (
    <aside
      aria-label="Your progress on this twister"
      className="glass mx-auto mt-8 flex max-w-md flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-2xl px-5 py-3 text-sm text-muted-foreground"
    >
      {hasHistory && (
        <>
          <span>
            Best <b className="text-lime">{h.best_score}</b>
          </span>
          <span>
            Attempts <b className="text-foreground">{h.count}</b>
          </span>
          <Sparkline scores={scores} />
        </>
      )}
      {twister.focus_sounds.length > 0 && (
        <span>
          Focus sounds{' '}
          <b className="text-foreground">{twister.focus_sounds.join(' · ')}</b>
        </span>
      )}
    </aside>
  )
}
