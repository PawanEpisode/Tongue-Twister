import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { DifficultyBadge } from '#/components/ui'
import { api } from '#/lib/api'
import type { Twister } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { useTwisterNavigation } from '#/lib/browseContext'
import { guestQueue } from '#/lib/syncQueue'
import ShareButton from './ShareButton'

const iconBtn = 'text-lg text-white/60 hover:text-white'

/** Difficulty, length, best score, favourite, share and previous/next for the current twister. */
export default function HubHeader({
  twister: t,
  settingsNotSynced,
}: {
  twister: Twister
  settingsNotSynced: boolean
}) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const { next, previous } = useTwisterNavigation(t)
  // Guests can star too: the intent is kept on-device and imported at sign-up (PRD 01 H6).
  const [guestFav, setGuestFav] = useState(() =>
    typeof window === 'undefined' ? false : guestQueue.isFavorite(t.slug),
  )
  const favorite = useMutation({
    mutationFn: () => api.favorite(t.slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['twister', t.slug] }),
  })
  const starred = session ? t.is_favorite : guestFav
  const toggleFavorite = () =>
    session ? favorite.mutate() : setGuestFav(guestQueue.toggleFavorite(t.slug))

  return (
    <div className="mb-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
      <button
        className={iconBtn}
        onClick={() => void previous()}
        aria-label="Previous twister"
      >
        ←
      </button>
      <DifficultyBadge level={t.difficulty} />
      <span className="text-xs uppercase tracking-widest text-white/40">
        {t.origin}
      </span>
      <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-white/60">
        {t.word_count} words
      </span>
      {t.best_score != null && (
        <span className="text-xs text-lime">Best {t.best_score}</span>
      )}
      <button
        onClick={toggleFavorite}
        aria-pressed={starred}
        aria-label={starred ? 'Remove from favourites' : 'Add to favourites'}
        title={
          session ? undefined : 'Saved on this device — sign in to keep it'
        }
        className={iconBtn}
      >
        {starred ? '★' : '☆'}
      </button>
      <ShareButton
        title={`“${t.text}” — tongue twister`}
        path={`/twisters/${t.slug}`}
      />
      {settingsNotSynced && (
        <span
          role="status"
          className="rounded-full border border-line px-2.5 py-0.5 text-xs text-white/50"
        >
          Settings not synced
        </span>
      )}
      <button
        className={iconBtn}
        onClick={() => void next()}
        aria-label="Next twister"
      >
        →
      </button>
    </div>
  )
}
