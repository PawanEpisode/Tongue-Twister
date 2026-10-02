import {
  AlertTriangle,
  Check,
  Loader2,
  Mic,
  RotateCcw,
  Square,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import LiveMeter from '#/components/dev/calibrate/LiveMeter'
import { Button } from '#/components/ui/button'
import { SCENARIOS } from '#/lib/calibrate/clip'
import type { Scenario } from '#/lib/calibrate/clip'
import { clock } from '#/lib/calibrate/coverage'
import type { Recorder } from '#/lib/calibrate/recorder'
import type { Analysis } from '#/lib/speak/engine/runtime/session'
import type { EngineStatus as WordStatus } from '#/lib/speak/engine/types'
import { cn } from '#/lib/utils'

export type Phase = 'idle' | 'starting' | 'recording' | 'analysing' | 'result'

export const SCENARIO_COPY: Record<Scenario, { label: string; blurb: string }> =
  {
    clean: { label: 'Clean', blurb: 'Clear, natural pace' },
    fast: { label: 'Fast', blurb: 'As fast as you can, every word' },
    swap: { label: 'Swap', blurb: 'Deliberately mispronounce one sound' },
    slur: { label: 'Slur', blurb: 'Quick and sloppy, words run together' },
  }

const WORD_TONE: Record<WordStatus, string> = {
  correct: 'border-lime/50 bg-lime/10 text-lime',
  near: 'border-cyan/50 bg-cyan/10 text-cyan',
  wrong: 'border-pink/50 bg-pink/10 text-pink',
  missed: 'border-destructive/50 bg-destructive/10 text-destructive',
  extra: 'border-border text-muted-foreground',
}

/** What a failed take means and what to do about it, in a speaker's words. */
function failure(a: Exclude<Analysis, { kind: 'scored' }>): {
  title: string
  tip: string
} {
  if (a.kind === 'gate') return { title: 'Audio wasn’t usable', tip: a.message }
  switch (a.reason) {
    case 'no_speech':
      return {
        title: 'No speech detected',
        tip: 'Check the right microphone is selected and speak a little closer to it.',
      }
    case 'nothing_recognised':
      return {
        title: 'Heard sound, but no words it could match',
        tip: 'Read the twister text shown above, in full, then press Stop. Speaking before pressing Record is the usual cause.',
      }
    default:
      return {
        title: 'Couldn’t follow the read',
        tip: 'Too many words were lost to align. Try a steadier pace, or choose another twister.',
      }
  }
}

function useElapsed(active: boolean) {
  const [ms, setMs] = useState(0)
  useEffect(() => {
    if (!active) return
    const t0 = Date.now()
    setMs(0)
    const id = setInterval(() => setMs(Date.now() - t0), 200)
    return () => clearInterval(id)
  }, [active])
  return ms
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  )
}

export default function RecorderStage({
  phase,
  scenario,
  onScenario,
  swapDisabled,
  words,
  instruction,
  blockers,
  recorder,
  analysis,
  error,
  savedId,
  keepable,
  onRecord,
  onStop,
  onKeep,
  onDiscard,
  onNext,
}: {
  phase: Phase
  scenario: Scenario
  onScenario: (s: Scenario) => void
  swapDisabled: boolean
  /** Null until a twister is loaded. */
  words: string[] | null
  instruction: string | null
  /** Why recording is not possible yet. Empty means ready. */
  blockers: string[]
  recorder: Recorder | null
  analysis: Analysis | null
  error: string | null
  savedId: string | null
  keepable: boolean
  onRecord: () => void
  onStop: () => void
  onKeep: () => void
  onDiscard: () => void
  onNext: (() => void) | null
}) {
  const recording = phase === 'recording'
  const elapsed = useElapsed(recording)
  const [heard, setHeard] = useState(false)
  useEffect(() => {
    if (recording) setHeard(false)
  }, [recording])
  // Be honest if nothing is coming in after a few seconds.
  const quiet = recording && !heard && elapsed > 3000

  const scored = analysis?.kind === 'scored' ? analysis : null
  const failed = analysis && analysis.kind !== 'scored' ? analysis : null
  const statusByIndex = new Map(
    scored?.assessment.words.map((w) => [w.index, w.status]) ?? [],
  )

  return (
    <section
      aria-label="Recorder"
      className={cn(
        'relative overflow-hidden rounded-3xl border bg-card/40 transition-colors',
        recording ? 'border-pink/70' : 'border-border/60',
      )}
    >
      {recording && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-pink/10 to-transparent"
        />
      )}

      {/* Scenario */}
      <div className="relative p-4 pb-0">
        <div
          role="radiogroup"
          aria-label="Scenario"
          className="grid grid-cols-2 gap-1.5 rounded-2xl bg-background/60 p-1 sm:grid-cols-4"
        >
          {SCENARIOS.map((s) => {
            const on = s === scenario
            const off = (s === 'swap' && swapDisabled) || phase !== 'idle'
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={off && !on}
                onClick={() => onScenario(s)}
                className={cn(
                  'rounded-xl px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40',
                  on
                    ? 'bg-primary text-primary-foreground shadow'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <span className="block text-sm font-semibold">
                  {SCENARIO_COPY[s].label}
                </span>
                <span
                  className={cn(
                    'hidden text-[11px] leading-tight sm:block',
                    on ? 'text-primary-foreground/80' : 'opacity-70',
                  )}
                >
                  {SCENARIO_COPY[s].blurb}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Prompt */}
      <div className="relative px-6 pt-8 pb-4 text-center">
        {words ? (
          <>
            <p
              className="flex flex-wrap justify-center gap-x-2 gap-y-2 font-display text-3xl leading-tight font-bold sm:text-4xl"
              aria-label={words.join(' ')}
            >
              {words.map((w, i) => {
                const st = statusByIndex.get(i)
                return (
                  <span
                    key={`${w}-${i}`}
                    className={cn(
                      'rounded-xl border border-transparent px-1.5 transition-colors',
                      st && WORD_TONE[st],
                    )}
                  >
                    {w}
                  </span>
                )
              })}
            </p>
            {instruction && (
              <p className="mx-auto mt-4 max-w-lg text-sm text-muted-foreground">
                {instruction}
              </p>
            )}
          </>
        ) : (
          <p className="py-6 text-muted-foreground">
            Pick a twister to see what to read.
          </p>
        )}
      </div>

      {/* Live area */}
      <div className="relative flex flex-col items-center gap-4 px-6 pb-8">
        {phase === 'recording' && recorder && (
          <div className="w-full max-w-md" role="status">
            <div className="mb-2 flex items-center justify-center gap-2 text-sm font-semibold text-pink">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-pink opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex size-2.5 rounded-full bg-pink" />
              </span>
              <span>Recording</span>
              <span className="font-mono tabular-nums">{clock(elapsed)}</span>
            </div>
            <LiveMeter
              analyser={recorder.analyser}
              onHeard={() => setHeard(true)}
            />
            <p
              className={cn(
                'mt-2 text-center text-sm',
                quiet ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {heard
                ? 'Hearing you. Press Stop when you finish the last word.'
                : quiet
                  ? 'Still silent. Check the microphone, or speak up.'
                  : 'Listening… start reading.'}
            </p>
          </div>
        )}

        {phase === 'starting' && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
            Waiting for the microphone. Allow access if the browser asks.
          </p>
        )}

        {phase === 'analysing' && (
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2
              className="size-4 animate-spin motion-reduce:animate-none"
              aria-hidden
            />
            Analysing your take on this device…
          </p>
        )}

        {/* The one big control */}
        {(phase === 'idle' ||
          phase === 'recording' ||
          phase === 'starting') && (
          <div className="flex flex-col items-center gap-2">
            {recording ? (
              <button
                type="button"
                onClick={onStop}
                className="group relative grid size-24 place-items-center rounded-full bg-pink text-pink-foreground outline-none transition-transform hover:scale-105 focus-visible:ring-4 focus-visible:ring-pink/40"
                aria-label="Stop recording"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 animate-ping rounded-full bg-pink/30 motion-reduce:animate-none"
                />
                <Square className="relative size-8 fill-current" aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                onClick={onRecord}
                disabled={blockers.length > 0 || phase === 'starting'}
                className="grid size-24 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 outline-none transition-transform hover:scale-105 focus-visible:ring-4 focus-visible:ring-ring/40 disabled:scale-100 disabled:opacity-40 disabled:shadow-none"
                aria-label="Start recording"
              >
                <Mic className="size-9" aria-hidden />
              </button>
            )}
            <p className="text-sm font-semibold">
              {recording
                ? 'Stop'
                : phase === 'starting'
                  ? 'Starting…'
                  : 'Record take'}
            </p>
            {!recording && phase === 'idle' && blockers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Press <Kbd>R</Kbd> to start, again to stop
              </p>
            )}
            {recording && (
              <p className="text-xs text-muted-foreground">
                or press <Kbd>R</Kbd>
              </p>
            )}
          </div>
        )}

        {phase === 'idle' && blockers.length > 0 && (
          <ul className="space-y-1 text-center text-sm text-muted-foreground">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        )}

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}

        {/* Saved confirmation */}
        {phase === 'idle' && savedId && !error && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-lime/40 bg-lime/10 px-4 py-2 text-sm"
          >
            <span className="flex items-center gap-1.5 text-lime">
              <Check className="size-4" aria-hidden />
              Saved <span className="font-mono">{savedId}</span>
            </span>
            {onNext && (
              <Button size="sm" onClick={onNext}>
                Next unrecorded
              </Button>
            )}
          </div>
        )}

        {/* Result */}
        {phase === 'result' && scored && (
          <div className="w-full max-w-md space-y-4 text-center">
            <div>
              <p className="font-display text-5xl font-bold tabular-nums">
                {scored.assessment.score}
              </p>
              <p className="text-xs text-muted-foreground">
                score · {Math.round(scored.inferenceMs)} ms on this device
              </p>
            </div>
            <ul className="flex flex-wrap justify-center gap-1.5 text-xs">
              {(['correct', 'near', 'wrong', 'missed'] as const).map((s) => {
                const n = scored.assessment.words.filter(
                  (w) => w.status === s,
                ).length
                return n ? (
                  <li
                    key={s}
                    className={cn(
                      'rounded-full border px-2.5 py-1',
                      WORD_TONE[s],
                    )}
                  >
                    {n} {s}
                  </li>
                ) : null
              })}
            </ul>
            {!keepable && (
              <p className="text-xs text-muted-foreground">
                This take has no posteriors to save. Record it again.
              </p>
            )}
            <div className="flex justify-center gap-2">
              <Button onClick={onKeep} disabled={!keepable}>
                <Check className="mr-1.5 size-4" aria-hidden />
                Keep clip <span className="ml-2 opacity-70">K</span>
              </Button>
              <Button variant="outline" onClick={onDiscard}>
                <RotateCcw className="mr-1.5 size-4" aria-hidden />
                Discard <span className="ml-2 opacity-70">D</span>
              </Button>
            </div>
          </div>
        )}

        {phase === 'result' && failed && (
          <div
            role="alert"
            className="w-full max-w-md space-y-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-center"
          >
            <p className="flex items-center justify-center gap-2 font-semibold text-destructive">
              <X className="size-4" aria-hidden />
              {failure(failed).title}
            </p>
            <p className="text-sm text-muted-foreground">
              {failure(failed).tip}
            </p>
            <Button onClick={onDiscard}>
              <RotateCcw className="mr-1.5 size-4" aria-hidden />
              Discard and record again{' '}
              <span className="ml-2 opacity-70">D</span>
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
