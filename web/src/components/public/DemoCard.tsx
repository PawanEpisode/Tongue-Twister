import { Mic, RotateCcw, Square, Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScoreRing } from '#/components/public/ScoreRing'
import { Button } from '#/components/ui/button'
import { DEMO_TWISTERS } from '#/content/demo'
import { useGate } from '#/lib/gate/useGate'
import { track } from '#/lib/observability/analytics'
import { scoreBand } from '#/lib/observability/events'
import { demoStore } from '#/lib/public/demoStore'
import { liveHits, scoreLocally } from '#/lib/scoring'
import type { LocalScore } from '#/lib/scoring'
import { displayWords } from '#/lib/speak/display'
import { useSpeech } from '#/lib/speech'
import type { SpeechResult } from '#/lib/speech'
import { cn } from '#/lib/utils'

type Phase = 'idle' | 'live' | 'result'

const verdict = (s: LocalScore, n: number) => {
  const good = s.statuses.filter((x) => x === 'correct' || x === 'near').length
  const slipped = s.display
    .filter(
      (_, i) =>
        s.statuses[i] &&
        s.statuses[i] !== 'correct' &&
        s.statuses[i] !== 'near',
    )
    .map((w) => w.text.replace(/[^\p{L}']/gu, ''))
  return slipped.length
    ? `You said ${good} of ${n} words clearly. “${slipped[0]}” slipped.`
    : `You said all ${n} words clearly. Clean run.`
}

/**
 * The AHA moment: say a real twister, watch the words light up, get a score. No account, nothing is sent
 * anywhere. The one result is kept in this tab only (sessionStorage) so signing up can claim it.
 */
export default function DemoCard() {
  const { request } = useGate()
  const [idx, setIdx] = useState(0)
  const tw = DEMO_TWISTERS[idx]
  const [phase, setPhase] = useState<Phase>('idle')
  const [mode, setMode] = useState<'voice' | 'example'>('voice')
  const [result, setResult] = useState<LocalScore | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [scripted, setScripted] = useState('')
  const timers = useRef<number[]>([])

  const finish = (r: SpeechResult) => {
    if (!r.transcript.trim()) {
      setPhase('idle')
      setNote(
        'We did not catch that. Check your mic and try again, or watch an example.',
      )
      return
    }
    const s = scoreLocally({
      text: tw.text,
      spoken: r.transcript,
      durationMs: Math.max(r.durationMs, 800),
      longPauseMs: r.longPauseMs,
      difficulty: tw.difficulty,
      focusSounds: tw.focus_sounds,
    })
    demoStore.set({
      slug: tw.slug,
      transcript: r.transcript,
      duration_ms: Math.round(Math.max(r.durationMs, 800)),
      score: s.score,
      created_at: new Date().toISOString(),
    })
    track('demo_completed', { score_band: scoreBand(s.score), mode: 'voice' })
    setMode('voice')
    setResult(s)
    setPhase('result')
    if (s.score >= 80)
      void import('canvas-confetti').then((c) =>
        c.default({ particleCount: 90, spread: 70, origin: { y: 0.7 } }),
      )
  }
  const speech = useSpeech({ onFinish: finish })
  const spoken =
    phase === 'live' ? speech.transcript : mode === 'example' ? scripted : ''
  const hits = useMemo(
    () => (spoken ? liveHits(tw.text, spoken, tw.focus_sounds) : []),
    [spoken, tw],
  )
  const words = useMemo(() => displayWords(tw.text), [tw])

  // Stop by itself: everything matched, or the speaker went quiet after saying something.
  useEffect(() => {
    if (phase !== 'live' || speech.status !== 'live' || !speech.transcript)
      return
    const all = hits.length > 0 && hits.every(Boolean)
    const id = window.setTimeout(speech.stop, all ? 600 : 2800)
    return () => window.clearTimeout(id)
  }, [phase, speech.status, speech.transcript, hits, speech.stop])

  useEffect(
    () => () => {
      timers.current.forEach(window.clearTimeout)
      speech.stop()
    },
    [],
  )

  const start = () => {
    setNote(null)
    setResult(null)
    setMode('voice')
    if (!speech.supported) {
      track('demo_unsupported')
      setNote(
        'Live listening is not available in this browser. Watch an example instead.',
      )
      return
    }
    track('demo_started', { twister: tw.slug })
    setPhase('live')
    void speech.start()
  }
  const watchExample = () => {
    speech.stop()
    setNote(null)
    setResult(null)
    setMode('example')
    setPhase('live')
    const parts = tw.example.split(' ')
    parts.forEach((_, i) => {
      timers.current.push(
        window.setTimeout(
          () => setScripted(parts.slice(0, i + 1).join(' ')),
          450 * (i + 1),
        ),
      )
    })
    timers.current.push(
      window.setTimeout(
        () => {
          const s = scoreLocally({
            text: tw.text,
            spoken: tw.example,
            durationMs: 3500,
            difficulty: tw.difficulty,
            focusSounds: tw.focus_sounds,
          })
          track('demo_completed', {
            score_band: scoreBand(s.score),
            mode: 'example',
          })
          setResult(s)
          setPhase('result')
        },
        450 * (parts.length + 1),
      ),
    )
  }
  const again = (next?: number) => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    speech.reset()
    setScripted('')
    setResult(null)
    setNote(null)
    setPhase('idle')
    if (next != null) setIdx(next)
  }
  const save = () => request({ intent: 'save_demo', returnTo: '/twisters' })

  return (
    <div id="demo" className="glass relative rounded-3xl p-5 shadow-xl sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-pink">
          Try it. No account needed.
        </p>
        <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground">
          Quick score
        </span>
      </div>

      <p
        className="mt-5 font-display text-2xl leading-snug sm:text-3xl"
        aria-live="polite"
        aria-label={tw.text}
      >
        {words.map((w, i) => {
          const st = result
            ? result.statuses[i]
            : hits.length
              ? hits[i]
                ? 'correct'
                : null
              : null
          return (
            <span
              key={i}
              className={cn(
                'mr-[0.3em] inline-block rounded-md px-0.5 transition-colors duration-300',
                st === 'correct' && 'bg-lime/20 text-lime',
                st === 'near' && 'bg-cyan/20 text-cyan',
                (st === 'wrong' || st === 'missed') && 'bg-pink/20 text-pink',
              )}
            >
              {w.text}
            </span>
          )
        })}
      </p>

      {phase === 'result' && result ? (
        <div className="mt-6 flex flex-wrap items-center gap-5">
          <ScoreRing
            score={result.score}
            label={mode === 'example' ? 'example' : 'score'}
          />
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm text-muted-foreground" role="status">
              {mode === 'example' ? 'An example run: ' : ''}
              {verdict(result, words.length)}
            </p>
            <div className="flex flex-wrap gap-2">
              {mode === 'voice' ? (
                <Button onClick={save}>Save this score</Button>
              ) : (
                <Button onClick={start}>Now you try</Button>
              )}
              <Button variant="outline" onClick={() => again()}>
                <RotateCcw className="mr-1.5 size-4" aria-hidden />
                Again
              </Button>
              <Button
                variant="ghost"
                onClick={() => again((idx + 1) % DEMO_TWISTERS.length)}
              >
                Try another
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {phase === 'live' && mode === 'voice' ? (
            <Button size="lg" onClick={() => speech.stop()} className="gap-2">
              <Square className="size-4" aria-hidden />
              Done
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={start}
              disabled={phase === 'live'}
              className="gap-2 shadow-lg shadow-primary/30"
            >
              <Mic className="size-5" aria-hidden />
              Tap and say it
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={watchExample}
            disabled={phase === 'live'}
            className="gap-2"
          >
            <Play className="size-4" aria-hidden />
            Watch an example
          </Button>
          {phase === 'live' && (
            <span className="text-sm text-muted-foreground" role="status">
              {mode === 'example'
                ? 'Watching an example…'
                : speech.status === 'live'
                  ? 'Listening… say it now'
                  : 'Getting the mic ready…'}
            </span>
          )}
        </div>
      )}
      {(note || speech.error) && phase !== 'result' && (
        <p role="alert" className="mt-3 text-sm text-muted-foreground">
          {note ?? speech.error}
        </p>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        Your voice isn’t recorded. Nothing is saved unless you create an
        account.
      </p>
    </div>
  )
}
