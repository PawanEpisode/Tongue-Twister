import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import QueueBoundary from './QueueBoundary'
import { api } from '#/lib/api'

const SOUNDS_SHOWN = 8

/** The sounds this person swaps most, from the accurate engine's per-sound feedback. */
export default function SoundsPanel({
  userId,
}: {
  userId: string | undefined
}) {
  const sounds = useQuery({
    queryKey: ['weak-sounds', userId],
    queryFn: () => api.weakSounds(SOUNDS_SHOWN),
    enabled: !!userId,
  })
  return (
    <div role="tabpanel" aria-label="Sounds you swap">
      <QueueBoundary
        pending={sounds.isPending}
        error={sounds.isError}
        empty={sounds.data?.length === 0}
        emptyText="Sound-by-sound feedback (like “you say s where it should be sh”) arrives with the accurate engine. Until then, your words are the best guide."
        errorText="Couldn’t load your sounds."
        onRetry={() => void sounds.refetch()}
      >
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sounds.data?.map((s) => {
            const pct = Math.round(s.error_rate * 100)
            return (
              <li
                key={s.pair}
                className="glass flex flex-col gap-3 rounded-2xl p-4 transition duration-200 hover:-translate-y-0.5 hover:border-primary/60"
              >
                <div className="flex items-center gap-2 font-display text-2xl font-extrabold">
                  <span className="rounded-xl bg-muted px-3 py-1">
                    {s.target}
                  </span>
                  <ArrowRight
                    className="size-5 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="rounded-xl bg-pink/15 px-3 py-1 text-pink">
                    {s.heard ?? 'dropped'}
                  </span>
                </div>
                <div>
                  <div
                    role="meter"
                    aria-label={`Swapped ${pct}% of ${s.occurrences} times`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-pink"
                      style={{ width: `${Math.max(6, pct)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Swapped {pct}% of {s.occurrences}{' '}
                    {s.occurrences === 1 ? 'time' : 'times'}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </QueueBoundary>
    </div>
  )
}
