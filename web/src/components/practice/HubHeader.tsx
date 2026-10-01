import { ChevronLeft, ChevronRight } from 'lucide-react'
import { FavoriteButton } from '#/components/progress/FavoriteButton'
import { MasteryBadge } from '#/components/progress/MasteryBadge'
import { DifficultyBadge } from '#/components/ui'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import type { Twister } from '#/lib/api'
import { useTwisterNavigation } from '#/lib/browseContext'
import ShareButton from './ShareButton'

/** Difficulty, length, best score, favourite, share and previous/next for the current twister. */
export default function HubHeader({
  twister: t,
  settingsNotSynced,
}: {
  twister: Twister
  settingsNotSynced: boolean
}) {
  const { next, previous } = useTwisterNavigation(t)

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
      <MasteryBadge state={t.mastery} />
      <Badge>{t.word_count} words</Badge>
      {t.best_score != null && (
        <span className="text-xs text-lime">Best {t.best_score}</span>
      )}
      <FavoriteButton twister={t} />
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
