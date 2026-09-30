import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useRouterState } from '@tanstack/react-router'
import Lottie from '#/components/ClientLottie'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import AudioVisualizer from '#/components/AudioVisualizer'
import pulse from '#/assets/lottie/pulse.json'
import ResultCard from '#/components/ResultCard'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { api } from '#/lib/api'
import type {
  AttemptResult,
  LowConfidenceResult,
  SubmitAttemptBody,
  Twister,
} from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { attemptQueue, isTransient } from '#/lib/attemptQueue'
import { useFlag } from '#/lib/flags'
import { SCORE_VERSION, liveHits, scoreLocally } from '#/lib/scoring'
import { displayStatuses, displayWords } from '#/lib/speak/display'
import type { DisplayWord, WordRow } from '#/lib/speak/display'
import type { WordStatus } from '#/lib/speak/similarity'
import { useSpeech } from '#/lib/speech'
import type { SpeechResult } from '#/lib/speech'
import { useTwisterNavigation } from '#/lib/browseContext'
import { draft } from '#/lib/draft'
import { guestQueue } from '#/lib/syncQueue'
import { usePracticeLock } from '#/lib/tabLock'
import { useMediaPermissions } from '#/lib/useMediaPermissions'
import { cn } from '#/lib/utils'
import PermissionNotice from './PermissionNotice'
import WordBreakdown from './WordBreakdown'

type Result = {
  score: number
  accuracy: number
  wpm: number
  xp?: number
  personalBest?: boolean
  levelUp?: boolean
  notice?: string
  attemptId?: number | null
  breakdown?: {
    display: DisplayWord[]
    statuses: (WordStatus | null)[]
    rows: WordRow[]
  }
}

const GATED_NOTICE =
  'Score capped at 79 — a slip on this twister’s focus sound. Nail that sound to go higher.'
const OFFLINE_NOTICE =
  'You’re offline — saved on this device and it will count once you’re back online.'
const UNSAVED_NOTICE =
  'We couldn’t save this attempt, so the score is an estimate.'

export default function SpeakAndScore({
  t,
  onReadAlong,
}: {
  t: Twister
  onReadAlong: () => void
}) {
  const twisterNav = useTwisterNavigation(t)
  const lock = usePracticeLock()
  const mic = useMediaPermissions('microphone')
  const qc = useQueryClient()
  const { session } = useAuth()
  const here = useRouterState({ select: (st) => st.location.href })
  const [result, setResult] = useState<Result | null>(null)
  const [typed, setTyped] = useState('')
  const [showGo, setShowGo] = useState(false)
  const typedStart = useRef(0)
  const currentRef = useRef<HTMLSpanElement | null>(null)

  const showBreakdown = useFlag('speak_v2')
  const [unclear, setUnclear] = useState<string | null>(null)
  const display = useMemo(() => displayWords(t.text), [t.text])

  /** The result screen for a local score: guests, offline, and failed saves. */
  const showLocal = (
    spoken: string,
    m: { durationMs: number; longPauseMs: number },
    notice?: string,
  ) => {
    const local = scoreLocally({
      text: t.text,
      spoken,
      difficulty: t.difficulty,
      focusSounds: t.focus_sounds,
      ...m,
    })
    setResult({
      score: local.score,
      accuracy: local.accuracy,
      wpm: local.wpm,
      notice: [notice, local.evaluation.score.focusGated && GATED_NOTICE]
        .filter(Boolean)
        .join(' '),
      breakdown: {
        display: local.display,
        statuses: local.statuses,
        rows: local.rows,
      },
    })
  }

  const submit = useMutation({
    mutationFn: api.submitAttempt,
    onSuccess: (r: AttemptResult | LowConfidenceResult) => {
      if (r.low_confidence) {
        setUnclear(r.reason)
        return
      }
      const rows: WordRow[] | undefined = r.words?.map((w) => ({
        targetIndex: w.target_index,
        spoken: w.spoken,
        status: w.status,
        reason: w.reason,
      }))
      setResult({
        score: r.score,
        accuracy: r.accuracy,
        wpm: r.wpm,
        xp: r.xp_awarded,
        personalBest: r.personal_best,
        levelUp: r.level_up,
        attemptId: r.id,
        notice: r.focus_gated ? GATED_NOTICE : undefined,
        breakdown: rows && {
          display,
          statuses: displayStatuses(display, rows),
          rows,
        },
      })
      qc.invalidateQueries({ queryKey: ['me'] })
      qc.invalidateQueries({ queryKey: ['history'] })
    },
  })

  const finish = (
    spoken: string,
    ms: number,
    meta: Partial<SpeechResult> = {},
  ) => {
    if (!spoken.trim()) return
    draft.clear(t.slug)
    const durationMs = Math.max(300, Math.round(ms))
    const timing = {
      durationMs,
      longPauseMs: Math.min(Math.round(meta.longPauseMs ?? 0), durationMs),
    }
    if (!session) {
      // Guests keep their history on-device; it is imported when they sign up (see GuestSync).
      guestQueue.addAttempt({
        twister: t.slug,
        transcript: spoken,
        duration_ms: durationMs,
      })
      showLocal(spoken, timing)
      return
    }
    const body: SubmitAttemptBody = {
      client_attempt_id: crypto.randomUUID(),
      twister: t.slug,
      kind: 'test',
      transcript: spoken,
      duration_ms: durationMs,
      long_pause_ms: timing.longPauseMs,
      stt: { engine: 'text_layer', confidence: meta.confidence ?? null },
      client_score: {
        version: SCORE_VERSION,
        score: scoreLocally({
          text: t.text,
          spoken,
          difficulty: t.difficulty,
          focusSounds: t.focus_sounds,
          ...timing,
        }).score,
      },
    }
    submit.mutate(body, {
      onError: (err) => {
        // Unreachable or throttled: keep it and replay later (the server de-duplicates on the id).
        if (isTransient(err)) {
          attemptQueue.add(session.user.id, body)
          showLocal(spoken, timing, OFFLINE_NOTICE)
        } else showLocal(spoken, timing, UNSAVED_NOTICE)
      },
    })
  }

  // A typed answer survives a sign-in round-trip (Google redirect) in this tab.
  useEffect(() => {
    const saved = draft.read(t.slug)
    if (!saved) return
    setTyped(saved)
    typedStart.current = Date.now()
  }, [t.slug])

  const speech = useSpeech({
    onFinish: (r) => finish(r.transcript, r.durationMs, r),
  })
  const isLong = t.word_count > 30

  // Flash "GO!" the moment the mic is truly capturing, so users never start talking too early.
  useEffect(() => {
    if (speech.status !== 'live') return
    setShowGo(true)
    const id = setTimeout(() => setShowGo(false), 900)
    return () => clearTimeout(id)
  }, [speech.status])

  const spoken =
    speech.status !== 'idle' ? speech.transcript : typed || speech.transcript
  const hits = useMemo(
    () => liveHits(t.text, spoken, t.focus_sounds),
    [t.text, t.focus_sounds, spoken],
  )
  const matched = hits.filter(Boolean).length
  const currentIdx = hits.findIndex((h) => !h)

  // Auto-finish: everything matched, or the speaker went quiet after saying something.
  useEffect(() => {
    if (speech.status !== 'live' || !hits.length) return
    if (matched === hits.length) {
      const id = setTimeout(speech.stop, 600)
      return () => clearTimeout(id)
    }
    if (speech.transcript) {
      const id = setTimeout(speech.stop, isLong ? 4500 : 2800)
      return () => clearTimeout(id)
    }
  }, [
    speech.status,
    speech.transcript,
    speech.stop,
    matched,
    hits.length,
    isLong,
  ])

  // Keep the current word in view for long passages.
  useEffect(() => {
    if (isLong)
      currentRef.current?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      })
  }, [currentIdx, isLong])

  const retry = () => {
    setResult(null)
    setUnclear(null)
    setTyped('')
    typedStart.current = 0
    speech.reset()
  }
  const startListening = async () => {
    // Ask only from this tap; skip the extra prompt when access is already known to be granted.
    if (mic.state === 'granted' || (await mic.requestAccess())) speech.start()
  }

  // One practising tab at a time.
  useEffect(() => {
    if (speech.status === 'idle') lock.release()
    else lock.claim()
  }, [speech.status, lock])

  const arming = speech.status === 'arming'
  const live = speech.status === 'live'
  const textSize =
    t.word_count <= 12
      ? 'text-3xl md:text-5xl'
      : t.word_count <= 30
        ? 'text-2xl md:text-4xl'
        : 'text-lg md:text-2xl'

  return (
    <div className="mx-auto max-w-3xl text-center">
      <AnimatePresence mode="wait">
        {result ? (
          <div key="r">
            <ResultCard
              score={result.score}
              accuracy={result.accuracy}
              wpm={result.wpm}
              xp={result.xp}
              personalBest={result.personalBest}
              levelUp={result.levelUp}
              notice={result.notice}
              onRetry={retry}
              onNext={() => void twisterNav.next()}
            >
              {showBreakdown && result.breakdown && (
                <WordBreakdown
                  {...result.breakdown}
                  onFeedback={
                    result.attemptId
                      ? async (index) => {
                          await api.wordFeedback(result.attemptId!, index, {
                            judged_correct: true,
                          })
                        }
                      : undefined
                  }
                />
              )}
            </ResultCard>
            {twisterNav.failed && (
              <p role="alert" className="mt-4 text-sm text-pink">
                Couldn’t fetch another twister — check your connection and tap
                Next again.
              </p>
            )}
          </div>
        ) : unclear ? (
          <div key="u" role="alert" className="mx-auto max-w-md">
            <h2 className="text-2xl font-bold">We couldn’t hear you clearly</h2>
            <p className="mt-2 text-muted-foreground">
              Nothing was scored or saved. Move closer to the mic, cut
              background noise and try once more.
            </p>
            <Button className="mt-5 px-6 py-3" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : (
          <motion.div
            key="p"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className={
                isLong
                  ? 'max-h-[42vh] overflow-y-auto rounded-2xl border border-border/60 bg-card/40 p-5 text-left'
                  : ''
              }
            >
              <p
                className={`font-display font-bold leading-snug ${textSize} ${isLong ? 'leading-relaxed' : ''} ${arming ? 'opacity-60' : ''}`}
              >
                {display.map((w, i) => (
                  <motion.span
                    key={i}
                    ref={i === currentIdx ? currentRef : undefined}
                    animate={{ scale: hits[i] ? 1.04 : 1 }}
                    className={cn(
                      'mr-2.5 inline-block rounded-md px-0.5 transition-colors',
                      hits[i] ? 'text-lime' : 'text-foreground',
                      live &&
                        i === currentIdx &&
                        'bg-primary/25 underline decoration-primary decoration-2 underline-offset-4',
                    )}
                  >
                    {w.text}
                  </motion.span>
                ))}
              </p>
            </div>
            {t.tip && !live && (
              <p className="mt-5 text-sm text-muted-foreground">💡 {t.tip}</p>
            )}

            {live && (
              <div className="mx-auto mt-5 h-1.5 max-w-md overflow-hidden rounded-full bg-card">
                <motion.div
                  className="h-full bg-gradient-to-r from-primary to-pink"
                  animate={{
                    width: `${(matched / Math.max(1, hits.length)) * 100}%`,
                  }}
                />
              </div>
            )}

            <div className="relative mx-auto mt-8 h-64 w-64">
              {arming && (
                <Lottie
                  animationData={pulse}
                  loop
                  className="absolute inset-0 h-full w-full"
                />
              )}
              {live && (
                <AudioVisualizer
                  analyser={speech.analyser}
                  className="absolute inset-0 h-full w-full"
                />
              )}
              <AnimatePresence>
                {showGo && (
                  <motion.div
                    key="go"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1.15, opacity: 1 }}
                    exit={{ scale: 1.6, opacity: 0 }}
                    className="pointer-events-none absolute inset-0 z-10 grid place-items-center font-display text-5xl font-extrabold text-lime hit-glow"
                  >
                    GO!
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.button
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: 1.05 }}
                disabled={
                  !speech.supported || arming || (lock.blocked && !live)
                }
                onClick={live ? speech.stop : () => void startListening()}
                aria-label={live ? 'Stop' : 'Start speaking'}
                className={`absolute inset-[72px] grid place-items-center rounded-full text-3xl shadow-xl disabled:cursor-wait ${live ? 'bg-pink text-pink-foreground shadow-pink/40' : 'bg-primary text-primary-foreground shadow-primary/40'} ${arming ? 'opacity-70' : ''}`}
              >
                {live ? '⏹' : arming ? '…' : '🎤'}
              </motion.button>
            </div>

            <p
              className="mt-1 text-sm text-muted-foreground"
              aria-live="polite"
            >
              {arming
                ? 'Getting your mic ready… wait for GO!'
                : live
                  ? speech.transcript
                    ? 'Keep going — I’ll stop when you finish'
                    : 'Listening… say it now'
                  : speech.supported
                    ? 'Tap the mic, wait for GO!, then say it as fast as you can'
                    : 'Speech recognition isn’t supported in this browser — type it below'}
            </p>
            <PermissionNotice
              state={mic.state}
              kind="microphone"
              onRetry={() => void startListening()}
              onReadAlong={onReadAlong}
            />
            {lock.blocked && !live && (
              <p role="status" className="mt-2 text-sm text-pink">
                Practice is active in another tab — finish it there first.
              </p>
            )}
            {speech.error && (
              <p className="mt-2 text-sm text-pink">{speech.error}</p>
            )}
            {live && speech.transcript && (
              <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
                “{speech.transcript}”
              </p>
            )}

            {!speech.supported && (
              <form
                className="mx-auto mt-6 max-w-xl"
                onSubmit={(e) => {
                  e.preventDefault()
                  finish(typed, Date.now() - typedStart.current)
                }}
              >
                <Input
                  value={typed}
                  onChange={(e) => {
                    if (!typedStart.current) typedStart.current = Date.now()
                    setTyped(e.target.value)
                    draft.write(t.slug, e.target.value)
                  }}
                  placeholder="Type the twister…"
                  className="glass rounded-2xl px-5 py-3"
                />
                <Button className="mt-3 px-6 py-2.5">Score it</Button>
              </form>
            )}
            {!session && (
              <p className="mt-8 text-xs text-muted-foreground">
                Playing as guest —{' '}
                <Link
                  to="/login"
                  search={{ redirect: here }}
                  className="underline"
                >
                  sign in
                </Link>{' '}
                to save scores, streaks and XP.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
