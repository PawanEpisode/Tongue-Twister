import { motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { Button } from '#/components/ui/button'
import type { Preferences, Twister } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { scoreLocally } from '#/lib/scoring'
import type { LocalScore } from '#/lib/scoring'
import { buildTrainPlan, chunkTwister } from '#/lib/speak/chunks'
import { displayWords, summarise } from '#/lib/speak/display'
import { unscorableReason } from '#/lib/speak/score'
import { useModelVoice } from '#/lib/useModelVoice'
import { usePracticeSubmit } from '#/lib/usePracticeSubmit'
import { useTake } from '#/lib/useTake'
import { cn } from '#/lib/utils'
import MicStage from './MicStage'
import WordBreakdown from './WordBreakdown'

/** A part is passed when at least this share of its words were said correctly or close (PRD 03 §4.2). */
export const PASS_COMPLETENESS = 0.85
const KIND_LABEL = {
  chunk: 'Short part',
  stitch: 'Two parts together',
  full: 'The whole twister',
} as const

type Outcome =
  { kind: 'unclear' } | { kind: 'scored'; passed: boolean; local: LocalScore }

/**
 * Train: learn a twister a few words at a time. Each part must be said well before the next unlocks,
 * then neighbouring parts are stitched together, then the whole twister. Attempts are saved as
 * `train` (small XP, no effect on best score or mastery).
 */
export default function TrainMode({
  twister,
  prefs,
  onSwitchMode,
}: {
  twister: Twister
  prefs: Preferences
  onSwitchMode: () => void
}) {
  const { session } = useAuth()
  const plan = useMemo(
    () => buildTrainPlan(chunkTwister(twister.text)),
    [twister.text],
  )
  const [index, setIndex] = useState(0)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [tries, setTries] = useState(0)
  const [xp, setXp] = useState(0)
  const [finished, setFinished] = useState(false)
  const save = usePracticeSubmit()
  const voice = useModelVoice(prefs.accent_lang, prefs.tts_voice)

  const step = plan[index]
  const display = useMemo(() => displayWords(step?.text ?? ''), [step?.text])

  const take = useTake({
    text: step?.text ?? '',
    focusSounds: twister.focus_sounds,
    onFinish: (r) => {
      if (!step) return
      const local = scoreLocally({
        text: step.text,
        spoken: r.transcript,
        durationMs: r.durationMs,
        longPauseMs: r.longPauseMs,
        difficulty: twister.difficulty,
        focusSounds: twister.focus_sounds,
      })
      if (unscorableReason(local.evaluation, r.confidence)) {
        setOutcome({ kind: 'unclear' })
        return
      }
      setTries((n) => n + 1)
      setOutcome({
        kind: 'scored',
        passed: local.evaluation.score.completeness >= PASS_COMPLETENESS,
        local,
      })
      void save({
        twister: twister.slug,
        kind: 'train',
        segment: { start: step.start, end: step.end },
        transcript: r.transcript,
        durationMs: r.durationMs,
        longPauseMs: r.longPauseMs,
        confidence: r.confidence,
      }).then((saved) => saved && setXp((x) => x + saved.xp_awarded))
    },
  })
  const { speech, hits, currentIdx, live } = take

  const tryAgain = () => {
    setOutcome(null)
    speech.reset()
  }
  const next = () => {
    tryAgain()
    setTries(0)
    if (index + 1 >= plan.length) setFinished(true)
    else setIndex(index + 1)
  }
  const restart = () => {
    tryAgain()
    setTries(0)
    setXp(0)
    setIndex(0)
    setFinished(false)
  }

  if (!step)
    return (
      <p className="text-muted-foreground">
        This twister has nothing to train on.
      </p>
    )

  if (finished)
    return (
      <div className="mx-auto max-w-md">
        <h2 className="text-2xl font-bold">🎉 Training complete</h2>
        <p className="mt-2 text-muted-foreground">
          You worked through all {plan.length} parts.
          {session
            ? ` +${xp} XP earned.`
            : ' Sign in to keep your training progress and XP.'}
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Button variant="outline" className="px-5 py-3" onClick={restart}>
            Train again
          </Button>
          <Button className="px-5 py-3" onClick={onSwitchMode}>
            Try the real thing →
          </Button>
        </div>
      </div>
    )

  const scored = outcome?.kind === 'scored' ? outcome : null
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Part {index + 1} of {plan.length} · {KIND_LABEL[step.kind]}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={plan.length}
        aria-valuenow={index}
        aria-label="Training progress"
        className="mx-auto mt-2 h-1.5 max-w-md overflow-hidden rounded-full bg-card"
      >
        <motion.div
          className="h-full bg-gradient-to-r from-primary to-pink"
          animate={{ width: `${(index / plan.length) * 100}%` }}
        />
      </div>

      {scored ? (
        <>
          <WordBreakdown
            display={scored.local.display}
            statuses={scored.local.statuses}
            rows={scored.local.rows}
          />
          <p
            role="status"
            className={cn(
              'mt-4 font-semibold',
              scored.passed ? 'text-lime' : 'text-pink',
            )}
          >
            {scored.passed
              ? 'Nice — you’ve got this part ✓'
              : `Not quite yet (${summarise(scored.local.rows)})`}
          </p>
        </>
      ) : (
        <p className="mt-6 font-display text-3xl font-bold leading-snug md:text-4xl">
          {display.map((w, i) => (
            <span
              key={i}
              className={cn(
                'mr-2.5 inline-block rounded-md px-0.5 transition-colors',
                hits[i] ? 'text-lime' : 'text-foreground',
                live &&
                  i === currentIdx &&
                  'bg-primary/25 underline decoration-primary decoration-2 underline-offset-4',
              )}
            >
              {w.text}
            </span>
          ))}
        </p>
      )}

      {outcome?.kind === 'unclear' && (
        <p role="alert" className="mt-4 text-pink">
          We couldn’t hear you clearly — nothing was scored. Try again a little
          closer to the mic.
        </p>
      )}

      {!scored && (
        <>
          {voice.supported && !live && (
            <div className="mt-4 flex justify-center gap-2">
              <ListenButton onClick={() => voice.say(step.text, 0.9)}>
                🔊 Listen
              </ListenButton>
              <ListenButton onClick={() => voice.say(step.text, 0.6)}>
                🐢 Slow
              </ListenButton>
            </div>
          )}
          <MicStage
            take={take}
            onReadAlong={onSwitchMode}
            idleHint="Tap the mic, wait for GO!, then say this part"
            unsupportedHint="Training needs speech recognition, which this browser doesn’t support — try Chrome or Edge."
          />
        </>
      )}

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {scored?.passed && (
          <Button className="px-6 py-3" onClick={next}>
            {index + 1 >= plan.length ? 'Finish' : 'Next part →'}
          </Button>
        )}
        {(scored && !scored.passed) || outcome?.kind === 'unclear' ? (
          <Button className="px-6 py-3" onClick={tryAgain}>
            Try again
          </Button>
        ) : null}
        {!scored?.passed && !live && (
          <Button
            variant="outline"
            className="px-5 py-3"
            onClick={next}
            disabled={take.arming}
          >
            {tries >= 3 ? 'Skip this part' : 'Skip'}
          </Button>
        )}
      </div>
      {!session && (
        <p className="mt-6 text-xs text-muted-foreground">
          Sign in to keep your training progress and XP.
        </p>
      )}
    </div>
  )
}

const ListenButton = ({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) => (
  <button
    type="button"
    onClick={onClick}
    className="rounded-full border border-border px-3 py-1.5 text-sm hover:bg-card"
  >
    {children}
  </button>
)
