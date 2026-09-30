import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Star } from 'lucide-react'
import { useState } from 'react'
import { DifficultyBadge } from '#/components/ui'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { api } from '#/lib/api'
import type { Twister } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { useTwisterNavigation } from '#/lib/browseContext'
import { guestQueue } from '#/lib/syncQueue'
import { cn } from '#/lib/utils'
import ShareButton from './ShareButton'

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
      <Button
        type="button"
        variant="ghost"
        className="px-1"
        onClick={() => void previous()}
        aria-label="Previous twister"
      >
        <ChevronLeft className="size-5" aria-hidden />
      </Button>
      <DifficultyBadge level={t.difficulty} />
      <span className="text-xs uppercase tracking-widest text-muted-foreground">
        {t.origin}
      </span>
      <Badge>{t.word_count} words</Badge>
      {t.best_score != null && (
        <span className="text-xs text-lime">Best {t.best_score}</span>
      )}
      <Button
        type="button"
        variant="ghost"
        onClick={toggleFavorite}
        aria-pressed={starred}
        aria-label={starred ? 'Remove from favourites' : 'Add to favourites'}
        title={
          session ? undefined : 'Saved on this device — sign in to keep it'
        }
        className="px-1"
      >
        <Star
          className={cn(
            'size-5',
            starred ? 'fill-pink text-pink' : 'text-muted-foreground',
          )}
          aria-hidden
        />
      </Button>
      <ShareButton
        title={`“${t.text}” — tongue twister`}
        path={`/twisters/${t.slug}`}
      />
      {settingsNotSynced && <Badge role="status">Settings not synced</Badge>}
      <Button
        type="button"
        variant="ghost"
        className="px-1"
        onClick={() => void next()}
        aria-label="Next twister"
      >
        <ChevronRight className="size-5" aria-hidden />
      </Button>
    </div>
  )
}
