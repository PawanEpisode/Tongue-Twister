import { Link } from '@tanstack/react-router'
import { AudioLines, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { FavoriteButton } from '#/components/progress/FavoriteButton'
import { Button } from '#/components/ui/button'
import type { GeneratedTwister } from '#/lib/generate/api'
import {
  CLAMP_WORDS,
  LENGTH_LABEL,
  LENGTH_TONE,
  countWords,
  estimatedSeconds,
  lengthBand,
  wordCountOf,
} from '#/lib/twisterCard/length'
import { repeatedPhrase } from '#/lib/twisterCard/repeats'
import { hasTrap } from '#/lib/twisterCard/trap'
import { cn } from '#/lib/utils'
import { TwisterPassage } from './TwisterPassage'
import { TwisterScore } from './TwisterScore'

function TextToggle({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="text-sm text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
    >
      {children}
    </button>
  )
}

/** One generated twister: length, the line, traps, score, sounds, and the actions. */
export function MyTwisterCard({
  twister,
  onDelete,
}: {
  twister: GeneratedTwister
  onDelete: () => void
}) {
  const words = wordCountOf(twister)
  const band = lengthBand(words)
  const seconds = estimatedSeconds(words)
  const sounds = twister.focus_sounds ?? []
  const attempts = twister.attempts_count ?? 0
  const repeat = repeatedPhrase(twister.text)
  const [showTrap, setShowTrap] = useState(false)
  const [readAll, setReadAll] = useState(false)
  const [showRepeats, setShowRepeats] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const onOverflow = useCallback((next: boolean) => {
    setOverflow((prev) => (prev === next ? prev : next))
  }, [])

  const display = repeat && !showRepeats ? repeat.phrase : twister.text
  const canClamp = countWords(display) > CLAMP_WORDS || overflow
  const showRead = canClamp || readAll

  const revealRepeats = () => {
    setShowRepeats((on) => !on)
    setReadAll(false)
    setOverflow(false)
  }

  return (
    <article className="glass rounded-3xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p
            className={cn(
              'flex items-center gap-1.5 text-sm font-semibold',
              LENGTH_TONE[band],
            )}
          >
            <AudioLines className="size-4" aria-hidden />
            {LENGTH_LABEL[band]}
          </p>
          <p className="text-sm text-muted-foreground">
            {words} {words === 1 ? 'word' : 'words'}
            {seconds > 0 ? ` · ~${seconds} sec` : ''}
          </p>
        </div>
        <FavoriteButton
          twister={{
            slug: twister.slug,
            text: twister.text,
            is_favorite: twister.is_favorite ?? false,
          }}
          activeClassName="fill-amber-400 text-amber-400"
          className="-mr-2 -mt-1"
        />
      </div>

      <div className="relative mt-3">
        <TwisterPassage
          text={display}
          focusSounds={sounds}
          showTrap={showTrap}
          clamped={!readAll}
          times={repeat && !showRepeats ? repeat.times : null}
          onOverflow={onOverflow}
        />
        {!readAll && showRead && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-card to-transparent"
            aria-hidden
          />
        )}
      </div>

      {(hasTrap(display, sounds) || showRead || repeat) && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {hasTrap(display, sounds) && (
            <TextToggle
              pressed={showTrap}
              onClick={() => setShowTrap((on) => !on)}
            >
              {showTrap ? 'Hide the trap' : 'Show the trap'}
            </TextToggle>
          )}
          {showRead && (
            <TextToggle
              pressed={readAll}
              onClick={() => setReadAll((on) => !on)}
            >
              {readAll ? 'Show less' : 'Read all'}
            </TextToggle>
          )}
          {repeat && (
            <TextToggle pressed={showRepeats} onClick={revealRepeats}>
              {showRepeats ? 'Show once' : 'Show every repeat'}
            </TextToggle>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <TwisterScore
          bestScore={twister.best_score ?? null}
          attempts={attempts}
        />
        <div className="flex flex-wrap items-center gap-2">
          {sounds.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Focus sounds">
              {sounds.map((sound) => (
                <li
                  key={sound}
                  className="grid h-8 min-w-8 place-items-center rounded-full bg-muted px-2 text-xs font-semibold text-foreground"
                >
                  {sound}
                </li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="size-9 rounded-full p-0"
            aria-label={`Delete twister: ${twister.text}`}
            onClick={onDelete}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
          <Button asChild size="sm" className="rounded-full px-5">
            <Link to="/twisters/$slug" params={{ slug: twister.slug }}>
              {attempts > 0 ? 'Practise' : 'Start'}
            </Link>
          </Button>
        </div>
      </div>
    </article>
  )
}
