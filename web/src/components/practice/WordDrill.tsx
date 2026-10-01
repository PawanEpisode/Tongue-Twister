import { Check, Turtle, Volume2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import type { DrillTarget, Preferences, WeakWord } from '#/lib/api'
import { scoreLocally } from '#/lib/scoring'
import { unscorableReason } from '#/lib/speak/score'
import { useModelVoice } from '#/lib/useModelVoice'
import { usePracticeSubmit } from '#/lib/usePracticeSubmit'
import { useTake } from '#/lib/useTake'
import { cn } from '#/lib/utils'
import MicStage from './MicStage'

/** A weak word that has somewhere to be drilled. */
export type DrillItem = WeakWord & { drill: DrillTarget }

/** The recogniser must be at least this sure (PRD 03 §4.4); a shaky "match" does not count. */
export const DRILL_MIN_CONFIDENCE = 0.6
/** After this many misses in a row the drill slows down and plays the word slowly. */
export const MISSES_BEFORE_HELP = 3

type Outcome = { kind: 'passed' | 'missed' | 'unclear'; heard?: string }

/** Word drill: one weak word at a time with a model voice, a spelling hint and its sentence for context. */
export default function WordDrill({
  items,
  prefs,
  onExit,
}: {
  items: DrillItem[]
  prefs: Preferences
  onExit: () => void
}) {
  const [index, setIndex] = useState(0)
  const [misses, setMisses] = useState(0)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [nailed, setNailed] = useState<string[]>([])
  const save = usePracticeSubmit()
  const voice = useModelVoice(prefs.accent_lang, prefs.tts_voice)

  const item = items[index] as DrillItem | undefined
  const take = useTake({
    text: item?.word ?? '',
    onFinish: (r) => {
      if (!item) return
      const local = scoreLocally({
        text: item.word,
        spoken: r.transcript,
        durationMs: r.durationMs,
        longPauseMs: r.longPauseMs,
        difficulty: 2,
      })
      if (unscorableReason(local.evaluation, r.confidence)) {
        setOutcome({ kind: 'unclear' })
        return
      }
      const status = local.rows.find((row) => row.targetIndex === 0)?.status
      const sure = r.confidence == null || r.confidence >= DRILL_MIN_CONFIDENCE
      const passed = (status === 'correct' || status === 'near') && sure
      setOutcome({ kind: passed ? 'passed' : 'missed', heard: r.transcript })
      if (passed) setNailed((n) => [...n, item.word])
      else {
        const total = misses + 1
        setMisses(total)
        if (total >= MISSES_BEFORE_HELP) voice.say(item.word, 0.6)
      }
      void save({
        twister: item.drill.twister,
        kind: 'drill',
        segment: { start: item.drill.start, end: item.drill.end },
        transcript: r.transcript,
        durationMs: r.durationMs,
        longPauseMs: r.longPauseMs,
        confidence: r.confidence,
      })
    },
  })
  const { speech, live } = take

  const tryAgain = () => {
    setOutcome(null)
    speech.reset()
  }
  const next = () => {
    tryAgain()
    setMisses(0)
    setIndex((i) => i + 1)
  }

  if (!item)
    return (
      <div className="mx-auto max-w-md text-center">
        <h2 className="text-2xl font-bold">Drill done</h2>
        <p className="mt-2 text-muted-foreground">
          You nailed {nailed.length} of {items.length}{' '}
          {items.length === 1 ? 'word' : 'words'}.
          {nailed.length > 0 && ' They move to Nailed.'}
        </p>
        {nailed.length > 0 && (
          <ul
            aria-label="Nailed words"
            className="mt-4 flex flex-wrap justify-center gap-2"
          >
            {nailed.map((w, i) => (
              <li
                key={`${w}-${i}`}
                className="inline-flex items-center gap-1 rounded-full bg-lime/15 px-3 py-1 text-sm font-semibold text-lime"
              >
                <Check className="size-3.5" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}
        <Button className="mt-6 px-6 py-3" onClick={onExit}>
          Back to my practice
        </Button>
      </div>
    )

  const { context, context_index: at } = item.drill
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Word {index + 1} of {items.length}
      </p>
      <p className="mt-4 text-muted-foreground" aria-label="In the twister">
        …
        {context.map((w, i) => (
          <span
            key={i}
            className={cn(
              'mx-1',
              i === at && 'font-bold text-foreground underline',
            )}
          >
            {w}
          </span>
        ))}
        …
      </p>
      <h2 className="mt-2 font-display text-6xl font-extrabold">{item.word}</h2>
      {item.respelling && (
        <p className="mt-2 text-muted-foreground">
          Say it like: <b>{item.respelling}</b>
        </p>
      )}
      {voice.supported && !live && (
        <div className="mt-4 flex justify-center gap-2">
          <button
            type="button"
            onClick={() => voice.say(item.word, 1)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:bg-card"
          >
            <Volume2 className="size-4" aria-hidden />
            Listen
          </button>
          <button
            type="button"
            onClick={() => voice.say(item.word, 0.6)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-sm hover:bg-card"
          >
            <Turtle className="size-4" aria-hidden />
            Slow
          </button>
        </div>
      )}

      {outcome?.kind === 'passed' ? (
        <p
          role="status"
          className="mt-8 flex items-center justify-center gap-2 text-xl font-semibold text-lime"
        >
          <Check className="size-5" aria-hidden />
          That’s it!
        </p>
      ) : (
        <MicStage
          take={take}
          idleHint="Tap the mic, wait for GO!, then say the word"
          unsupportedHint="Word drill needs speech recognition, which this browser doesn’t support — try Chrome or Edge."
        />
      )}
      {outcome?.kind === 'missed' && (
        <p role="status" className="mt-2 text-pink">
          We heard “{outcome.heard}”.{' '}
          {misses >= MISSES_BEFORE_HELP
            ? 'Take a breath — try saying it slowly.'
            : 'Give it another go.'}
        </p>
      )}
      {outcome?.kind === 'unclear' && (
        <p role="alert" className="mt-2 text-pink">
          We couldn’t hear you clearly — try again a little closer to the mic.
        </p>
      )}

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {outcome?.kind === 'passed' && (
          <Button className="px-6 py-3" onClick={next}>
            {index + 1 >= items.length ? 'Finish' : 'Next word →'}
          </Button>
        )}
        {(outcome?.kind === 'missed' || outcome?.kind === 'unclear') && (
          <Button className="px-6 py-3" onClick={tryAgain}>
            Try again
          </Button>
        )}
        {outcome?.kind !== 'passed' && !live && (
          <Button variant="outline" className="px-5 py-3" onClick={next}>
            Skip
          </Button>
        )}
      </div>
    </div>
  )
}
