import { useQuery } from '@tanstack/react-query'
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
        <ul className="mt-4 space-y-2">
          {sounds.data?.map((s) => (
            <li
              key={s.pair}
              className="glass flex items-center justify-between rounded-2xl px-4 py-2.5"
            >
              <span>
                <b>{s.target}</b> → <b>{s.heard ?? 'dropped'}</b>
              </span>
              <span className="text-sm text-muted-foreground">
                {Math.round(s.error_rate * 100)}% of {s.occurrences}
              </span>
            </li>
          ))}
        </ul>
      </QueueBoundary>
    </div>
  )
}
