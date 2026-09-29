import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Lottie from '#/components/ClientLottie'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import pulse from '#/assets/lottie/pulse.json'
import ResultCard from '#/components/ResultCard'
import { DifficultyBadge } from '#/components/ui'
import { api } from '#/lib/api'
import type { AttemptResult } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { matchedIndexes, scoreAttempt } from '#/lib/scoring'
import { useSpeech } from '#/lib/speech'

export const Route = createFileRoute('/twisters/$slug')({ component: Practice })

type Result = {
  score: number
  accuracy: number
  wpm: number
  xp?: number
  personalBest?: boolean
  levelUp?: boolean
}

function Practice() {
  const { slug } = Route.useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const { session } = useAuth()
  const { data: t } = useQuery({
    queryKey: ['twister', slug],
    queryFn: () => api.twister(slug),
  })
  const speech = useSpeech()
  const [result, setResult] = useState<Result | null>(null)
  const [typed, setTyped] = useState('')
  const typedStart = useRef(0)
  const wasListening = useRef(false)

  const submit = useMutation({
    mutationFn: api.submitAttempt,
    onSuccess: (r: AttemptResult) => {
      setResult({
        score: r.score,
        accuracy: r.accuracy,
        wpm: r.wpm,
        xp: r.xp_awarded,
        personalBest: r.personal_best,
        levelUp: r.level_up,
      })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const finish = (spoken: string, ms: number) => {
    if (!t || !spoken.trim()) return
    if (session) {
      submit.mutate(
        { twister: t.slug, transcript: spoken, duration_ms: Math.max(300, ms) },
        {
          onError: () =>
            setResult(scoreAttempt(t.text, spoken, ms, t.difficulty)),
        },
      )
    } else setResult(scoreAttempt(t.text, spoken, ms, t.difficulty))
  }

  useEffect(() => {
    if (wasListening.current && !speech.listening)
      finish(speech.transcript, speech.durationMs)
    wasListening.current = speech.listening
  }, [speech.listening])

  const live = speech.listening ? speech.transcript : typed || speech.transcript
  const hits = useMemo(() => (t ? matchedIndexes(t.text, live) : []), [t, live])
  const targetWords = t?.text.split(/\s+/) ?? []

  const retry = () => {
    setResult(null)
    setTyped('')
    speech.setTranscript('')
  }
  const next = async () => {
    const page = await api.twisters({ difficulty: String(t?.difficulty ?? 1) })
    const others = page.results.filter((x) => x.slug !== slug)
    const pick = others[Math.floor(Math.random() * others.length)]
    retry()
    if (pick) nav({ to: '/twisters/$slug', params: { slug: pick.slug } })
  }

  if (!t) return <p className="text-white/50">Loading…</p>
  return (
    <div className="mx-auto max-w-3xl text-center">
      <div className="mb-6 flex items-center justify-center gap-3">
        <DifficultyBadge level={t.difficulty} />
        <span className="text-xs uppercase tracking-widest text-white/40">
          {t.origin}
        </span>
      </div>
      <AnimatePresence mode="wait">
        {result ? (
          <ResultCard key="r" {...result} onRetry={retry} onNext={next} />
        ) : (
          <motion.div
            key="p"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <p className="font-display text-3xl font-bold leading-snug md:text-5xl">
              {targetWords.map((w, i) => (
                <motion.span
                  key={i}
                  animate={{
                    color: hits[i] ? '#a3f75b' : '#ecebff',
                    scale: hits[i] ? 1.06 : 1,
                  }}
                  className="mr-3 inline-block"
                >
                  {w}
                </motion.span>
              ))}
            </p>
            {t.tip && <p className="mt-5 text-sm text-white/50">💡 {t.tip}</p>}

            <div className="relative mx-auto mt-10 h-40 w-40">
              {speech.listening && (
                <Lottie
                  animationData={pulse}
                  loop
                  className="absolute inset-0 h-full w-full"
                />
              )}
              <motion.button
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: 1.06 }}
                disabled={!speech.supported}
                onClick={speech.listening ? speech.stop : speech.start}
                aria-label={speech.listening ? 'Stop' : 'Start speaking'}
                className={`absolute inset-6 grid place-items-center rounded-full text-4xl shadow-xl disabled:opacity-40 ${speech.listening ? 'bg-pink shadow-pink/40' : 'bg-brand shadow-brand/40'}`}
              >
                {speech.listening ? '⏹' : '🎤'}
              </motion.button>
            </div>
            <p className="mt-2 text-sm text-white/60">
              {speech.listening
                ? 'Listening… tap to finish'
                : speech.supported
                  ? 'Tap the mic and say it as fast as you can'
                  : 'Speech recognition isn’t supported in this browser — type it below'}
            </p>
            {speech.error && (
              <p className="mt-2 text-sm text-pink">{speech.error}</p>
            )}
            {speech.listening && (
              <p className="mx-auto mt-4 max-w-xl text-white/40">
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
                <input
                  value={typed}
                  onChange={(e) => {
                    if (!typedStart.current) typedStart.current = Date.now()
                    setTyped(e.target.value)
                  }}
                  placeholder="Type the twister…"
                  className="glass w-full rounded-2xl px-5 py-3 outline-none focus:border-brand"
                />
                <button className="mt-3 rounded-xl bg-brand px-6 py-2.5 font-semibold">
                  Score it
                </button>
              </form>
            )}
            {!session && (
              <p className="mt-10 text-xs text-white/35">
                Playing as guest — sign in to save scores, streaks and XP.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
