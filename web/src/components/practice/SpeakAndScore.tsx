import { usePracticeStarted } from '#/lib/observability/usePracticeStarted'
import { track } from '#/lib/observability/analytics'
import { scoreBand } from '#/lib/observability/events'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Lightbulb } from 'lucide-react'
import { Link, useRouterState } from '@tanstack/react-router'
import { AnimatePresence, m } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ResultCard from '#/components/ResultCard'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { api } from '#/lib/api'
import type {
  AttemptResult,
  LowConfidenceResult,
  SubmitAttemptBody,
  Twister,
  UnlockedAchievement,
} from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { attemptQueue, isTransient } from '#/lib/attemptQueue'
import { unsavedReason } from '#/lib/submitNotice'
import { useFlag } from '#/lib/flags'
import { SCORE_VERSION, scoreLocally } from '#/lib/scoring'
import {
  displayStatuses,
  displayWords,
  problemRows,
  rowsFromApi,
} from '#/lib/speak/display'
import { unscorableReason } from '#/lib/speak/score'
import type { DisplayWord, WordRow } from '#/lib/speak/display'
import type { WordStatus } from '#/lib/speak/similarity'
import type { SpeechResult } from '#/lib/speech'
import { useTwisterNavigation } from '#/lib/browseContext'
import { draft } from '#/lib/draft'
import { invalidateProgress } from '#/lib/progress/invalidate'
import { announceAchievements } from '#/lib/progress/useAchievementToasts'
import { guestQueue } from '#/lib/syncQueue'
import { useTake } from '#/lib/useTake'
import { cn } from '#/lib/utils'
import MicStage from './MicStage'
import WordBreakdown from './WordBreakdown'

type Result = {
  score: number
  accuracy: number
  wpm: number
  xp?: number
  personalBest?: boolean
  levelUp?: boolean
  unlocked?: UnlockedAchievement[]
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
  const qc = useQueryClient()
  const { session } = useAuth()
  const here = useRouterState({ select: (st) => st.location.href })
  const [result, setResult] = useState<Result | null>(null)
  const [typed, setTyped] = useState('')
  const typedStart = useRef(0)
  const currentRef = useRef<HTMLSpanElement | null>(null)

  const showBreakdown = useFlag('speak_v2')
  const [unclear, setUnclear] = useState<string | null>(null)
  const display = useMemo(() => displayWords(t.text), [t.text])

  /**
   * The result screen for a local score: guests, offline, and failed saves.
   * Returns false (and asks for another try) when the take is too unclear to score fairly.
   */
  const showLocal = (
    spoken: string,
    timing: { durationMs: number; longPauseMs: number },
    confidence: number | null | undefined,
    notice?: string,
  ): boolean => {
    const local = scoreLocally({
      text: t.text,
      spoken,
      difficulty: t.difficulty,
      focusSounds: t.focus_sounds,
      ...timing,
    })
    const unclearReason = unscorableReason(local.evaluation, confidence)
    if (unclearReason) {
      setUnclear(unclearReason)
      return false
    }
    track('attempt_completed', {
      kind: 'test',
      score_band: scoreBand(local.score),
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
    return true
  }

  const submit = useMutation({
    mutationFn: api.submitAttempt,
    onSuccess: (r: AttemptResult | LowConfidenceResult) => {
      if (r.low_confidence) {
        setUnclear(r.reason)
        return
      }
      track('attempt_completed', {
        kind: 'test',
        score_band: scoreBand(r.score),
      })
      const rows = r.words && rowsFromApi(r.words)
      setResult({
        score: r.score,
        accuracy: r.accuracy,
        wpm: r.wpm,
        xp: r.xp_awarded,
        personalBest: r.personal_best,
        levelUp: r.level_up,
        unlocked: r.achievements_unlocked,
        attemptId: r.id,
        notice: r.focus_gated ? GATED_NOTICE : undefined,
        breakdown: rows && {
          display,
          statuses: displayStatuses(display, rows),
          rows,
        },
      })
      announceAchievements(r.achievements_unlocked)
      void invalidateProgress(qc)
      void qc.invalidateQueries({ queryKey: ['history'] })
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
      if (showLocal(spoken, timing, meta.confidence))
        guestQueue.addAttempt({
          twister: t.slug,
          transcript: spoken,
          duration_ms: durationMs,
        })
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
          // Only queue a take the server would have accepted (it rejects unclear ones anyway).
          if (showLocal(spoken, timing, meta.confidence, unsavedReason(err)))
            attemptQueue.add(session.user.id, body)
        } else showLocal(spoken, timing, meta.confidence, UNSAVED_NOTICE)
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

  const isLong = t.word_count > 30
  const take = useTake({
    text: t.text,
    focusSounds: t.focus_sounds,
    typed,
    isLong,
    onFinish: (r) => finish(r.transcript, r.durationMs, r),
  })
  const { speech, hits, matched, currentIdx, arming, live } = take
  usePracticeStarted('speak_score', live)

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
              unlocked={result.unlocked}
              notice={result.notice}
              attemptId={result.attemptId}
              onRetry={retry}
              onNext={() => void twisterNav.next()}
            >
              {showBreakdown && result.breakdown && (
                <WordBreakdown
                  {...result.breakdown}
                  onFeedback={
                    result.attemptId
                      ? async (index, feedback) => {
                          await api.wordFeedback(
                            result.attemptId!,
                            index,
                            feedback,
                          )
                        }
                      : undefined
                  }
                />
              )}
              {session &&
                result.breakdown &&
                problemRows(result.breakdown.rows).length > 0 && (
                  <Link
                    to="/practice"
                    search={{ drill: 1 }}
                    className="mt-4 inline-block text-sm underline underline-offset-2"
                  >
                    Drill your weak words →
                  </Link>
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
          <m.div
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
                  <m.span
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
                  </m.span>
                ))}
              </p>
            </div>
            {t.tip && !live && (
              <p className="mt-5 flex items-start justify-center gap-2 text-sm text-muted-foreground">
                <Lightbulb
                  className="mt-0.5 size-4 shrink-0 text-brand"
                  aria-hidden
                />
                {t.tip}
              </p>
            )}

            {live && (
              <div className="mx-auto mt-5 h-1.5 max-w-md overflow-hidden rounded-full bg-card">
                <m.div
                  className="h-full bg-gradient-to-r from-primary to-pink"
                  animate={{
                    width: `${(matched / Math.max(1, hits.length)) * 100}%`,
                  }}
                />
              </div>
            )}

            <MicStage take={take} onReadAlong={onReadAlong} />

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
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
