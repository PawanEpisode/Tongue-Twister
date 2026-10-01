import { ChevronLeft, ChevronRight } from 'lucide-react'
import { MASTERY } from '#/components/progress/MasteryBadge'
import { FavoriteButton } from '#/components/progress/FavoriteButton'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import type { Twister } from '#/lib/api'
import { useTwisterNavigation } from '#/lib/browseContext'
import ShareButton from './ShareButton'

const LEVELS = ['', 'Easy', 'Medium', 'Hard', 'Insane'] as const

function factsOf(t: Twister) {
  return [
    LEVELS[t.difficulty],
    t.origin === 'classic' ? 'Classic' : 'Modern',
    t.mastery ? MASTERY[t.mastery].label : null,
    `${t.word_count} words`,
    t.best_score != null ? `Best ${t.best_score}` : null,
  ].filter((part): part is string => !!part)
}

/** Previous and next, favourite and share, then the facts as pills. */
export default function HubHeader({
  twister: t,
  settingsNotSynced,
}: {
  twister: Twister
  settingsNotSynced: boolean
}) {
  const { next, previous } = useTwisterNavigation(t)

  return (
    <div className="mb-6">
      <div className="relative flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          className="size-11 rounded-full p-0"
          onClick={() => void previous()}
          aria-label="Previous twister"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
        <div className="flex items-center gap-1">
          <FavoriteButton twister={t} className="border border-border" />
          <ShareButton
            icon
            title={`“${t.text}” — tongue twister`}
            path={`/twisters/${t.slug}`}
          />
          <Button
            type="button"
            variant="outline"
            className="size-11 rounded-full p-0"
            onClick={() => void next()}
            aria-label="Next twister"
          >
            <ChevronRight className="size-5" aria-hidden />
          </Button>
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap justify-center gap-2">
        {factsOf(t).map((fact) => (
          <li key={fact}>
            <Badge variant="outline" className="px-3 py-1 font-medium">
              {fact}
            </Badge>
          </li>
        ))}
      </ul>
      {settingsNotSynced && (
        <p className="mt-2 text-center">
          <Badge role="status">Settings not synced</Badge>
        </p>
      )}
    </div>
  )
}
