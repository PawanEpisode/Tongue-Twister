import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { api } from '#/lib/api'
import type { Twister } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { displayStatuses, displayWords, rowsFromApi } from '#/lib/speak/display'
import WordBreakdown from './WordBreakdown'

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

/** One past attempt, word by word. Train and drill takes keep no per-word rows, so there may be none. */
function AttemptDetailView({ id, twister }: { id: number; twister: Twister }) {
  const q = useQuery({
    queryKey: ['attempt', id],
    queryFn: () => api.attemptDetail(id),
    staleTime: Infinity, // a saved attempt never changes
  })
  const display = useMemo(() => displayWords(twister.text), [twister.text])
  if (q.isPending) return <p className="mt-3 text-xs">Loading…</p>
  if (q.isError)
    return (
      <p role="alert" className="mt-3 text-xs text-pink">
        Couldn’t load this attempt.
      </p>
    )
  const rows = rowsFromApi(q.data.words)
  if (!rows.some((r) => r.targetIndex != null))
    return (
      <p className="mt-3 text-xs">
        No word details were kept for this attempt.
      </p>
    )
  return (
    <WordBreakdown
      display={display}
      statuses={displayStatuses(display, rows)}
      rows={rows}
      onFeedback={async (index, feedback) => {
        await api.wordFeedback(id, index, feedback)
      }}
    />
  )
}

function trendOf(scores: number[]) {
  if (scores.length < 2) return 'One more try'
  const first = scores[0]
  const last = scores[scores.length - 1]
  if (last > first) return `Up to ${last} from ${first}`
  if (last < first) return `Down from ${first}`
  return `Steady at ${last}`
}

function attemptDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
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
  const [openId, setOpenId] = useState<number | null>(null)
  const hasHistory = !!h && h.count > 0
  if (!hasHistory && !twister.focus_sounds.length) return null

  const scores = (h?.results ?? []).map((r) => r.score).reverse()
  const trend = trendOf(scores)
  return (
    <aside
      aria-label="Your progress on this twister"
      className="glass mx-auto mt-8 max-w-md rounded-2xl px-5 py-4 text-left text-sm"
    >
      <h2 className="text-center font-display text-lg font-bold text-foreground">
        Your progress
      </h2>
      {hasHistory && (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <dt className="text-xs text-muted-foreground">Best</dt>
              <dd className="font-display text-2xl font-bold text-lime">
                {h.best_score}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Tries</dt>
              <dd className="font-display text-2xl font-bold text-foreground">
                {h.count}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Trend</dt>
              <dd className="text-sm leading-snug font-semibold text-foreground">
                {trend}
              </dd>
            </div>
          </dl>
          <figure className="mt-3 flex flex-col items-center">
            <Sparkline scores={scores} />
            <figcaption className="mt-1 text-center text-xs text-muted-foreground">
              {trend}
            </figcaption>
          </figure>
        </>
      )}
      {twister.focus_sounds.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground">
            Sounds to land
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {twister.focus_sounds.map((sound) => (
              <li
                key={sound}
                className="rounded-full bg-primary/10 px-2.5 py-0.5 font-semibold text-foreground"
              >
                {sound}
              </li>
            ))}
          </ul>
        </div>
      )}
      {hasHistory && (
        <div className="mt-4">
          <p className="text-xs font-medium text-muted-foreground">
            Recent tries
          </p>
          <ul className="mt-1 divide-y divide-border">
            {h.results.slice(0, 5).map((r) => {
              const best = r.score === h.best_score
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-expanded={openId === r.id}
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                    className="flex w-full items-center justify-between py-2 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="text-muted-foreground">
                      {attemptDate(r.created_at)}
                    </span>
                    <span className="font-semibold text-foreground tabular-nums">
                      {r.score}
                      {best && (
                        <span className="ml-2 text-xs font-medium text-lime">
                          Best
                        </span>
                      )}
                    </span>
                  </button>
                  {openId === r.id && (
                    <AttemptDetailView id={r.id} twister={twister} />
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </aside>
  )
}
