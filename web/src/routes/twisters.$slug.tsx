import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Lottie from '#/components/ClientLottie'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import AudioVisualizer from '#/components/AudioVisualizer'
import pulse from '#/assets/lottie/pulse.json'
import ResultCard from '#/components/ResultCard'
import { DifficultyBadge } from '#/components/ui'
import { api } from '#/lib/api'
import type { AttemptResult } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { matchedIndexes, scoreAttempt } from '#/lib/scoring'
import { useSpeech } from '#/lib/speech'
import { ErrorState, PracticeSkeleton } from '#/components/feedback'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/twisters/$slug')({
  // Runs on the server for first loads so link-preview scrapers (WhatsApp, iMessage, Slack) get real tags.
  loader: async ({ params }) => {
    try {
      return await api.twister(params.slug)
    } catch {
      return null
    }
  },
  head: ({ loaderData, params }) =>
    seo(
      loaderData
        ? {
            title: `“${loaderData.text}” — ${loaderData.difficulty_label} tongue twister | Twister`,
            description:
              `Can you say it fast? Try this ${loaderData.difficulty_label.toLowerCase()} ${loaderData.origin} tongue twister out loud and get an instant score. ${loaderData.tip}`.trim(),
            path: `/twisters/${params.slug}`,
          }
        : {
            title: 'Tongue twister | Twister',
            path: `/twisters/${params.slug}`,
          },
    ),
  component: Practice,
})

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
  const {
    data: t,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['twister', slug],
    queryFn: () => api.twister(slug),
  })
  const [result, setResult] = useState<Result | null>(null)
  const [typed, setTyped] = useState('')
  const [showGo, setShowGo] = useState(false)
  const [nextFailed, setNextFailed] = useState(false)
  const typedStart = useRef(0)
  const currentRef = useRef<HTMLSpanElement | null>(null)

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

  const speech = useSpeech({
    onFinish: ({ transcript, durationMs }) => finish(transcript, durationMs),
  })
  const isLong = (t?.word_count ?? 0) > 30

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
    () => (t ? matchedIndexes(t.text, spoken) : []),
    [t, spoken],
  )
  const matched = hits.filter(Boolean).length
  const currentIdx = hits.findIndex((h) => !h)
  const targetWords = t?.text.split(/\s+/) ?? []

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
    setTyped('')
    typedStart.current = 0
    speech.reset()
  }
  const next = async () => {
    const page = await api
      .twisters({ difficulty: String(t?.difficulty ?? 1) })
      .catch(() => null)
    if (!page) return setNextFailed(true)
    const others = page.results.filter((x) => x.slug !== slug)
    const pick = others[Math.floor(Math.random() * others.length)]
    retry()
    setNextFailed(false)
    if (pick) nav({ to: '/twisters/$slug', params: { slug: pick.slug } })
  }

  if (isError)
    return (
      <ErrorState
        title={
          /API 404/.test(String((error as Error).message))
            ? 'Twister not found'
            : 'Couldn’t load this twister'
        }
        error={error}
        onRetry={() => void refetch()}
      >
        <Link
          to="/twisters"
          className="rounded-xl border border-line px-5 py-2.5 text-sm font-semibold hover:border-brand"
        >
          Browse twisters
        </Link>
      </ErrorState>
    )
  if (!t) return <PracticeSkeleton />

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
      <div className="mb-6 flex items-center justify-center gap-3">
        <DifficultyBadge level={t.difficulty} />
        <span className="text-xs uppercase tracking-widest text-white/40">
          {t.origin}
        </span>
        {isLong && (
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-white/60">
            {t.word_count} words
          </span>
        )}
      </div>
      <AnimatePresence mode="wait">
        {result ? (
          <div key="r">
            <ResultCard {...result} onRetry={retry} onNext={next} />
            {nextFailed && (
              <p role="alert" className="mt-4 text-sm text-pink">
                Couldn’t fetch another twister — check your connection and tap
                Next again.
              </p>
            )}
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
                  ? 'max-h-[42vh] overflow-y-auto rounded-2xl border border-line/60 bg-panel/40 p-5 text-left'
                  : ''
              }
            >
              <p
                className={`font-display font-bold leading-snug ${textSize} ${isLong ? 'leading-relaxed' : ''} ${arming ? 'opacity-60' : ''}`}
              >
                {targetWords.map((w, i) => (
                  <motion.span
                    key={i}
                    ref={i === currentIdx ? currentRef : undefined}
                    animate={{
                      color: hits[i] ? '#a3f75b' : '#ecebff',
                      scale: hits[i] ? 1.04 : 1,
                    }}
                    className={`mr-2.5 inline-block rounded-md px-0.5 transition-colors ${live && i === currentIdx ? 'bg-brand/25 underline decoration-brand decoration-2 underline-offset-4' : ''}`}
                  >
                    {w}
                  </motion.span>
                ))}
              </p>
            </div>
            {t.tip && !live && (
              <p className="mt-5 text-sm text-white/50">💡 {t.tip}</p>
            )}

            {live && (
              <div className="mx-auto mt-5 h-1.5 max-w-md overflow-hidden rounded-full bg-panel">
                <motion.div
                  className="h-full bg-gradient-to-r from-brand to-pink"
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
                    className="pointer-events-none absolute inset-0 z-10 grid place-items-center font-display text-5xl font-extrabold text-lime drop-shadow-[0_0_24px_rgba(163,247,91,.7)]"
                  >
                    GO!
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.button
                whileTap={{ scale: 0.92 }}
                whileHover={{ scale: 1.05 }}
                disabled={!speech.supported || arming}
                onClick={live ? speech.stop : speech.start}
                aria-label={live ? 'Stop' : 'Start speaking'}
                className={`absolute inset-[72px] grid place-items-center rounded-full text-3xl shadow-xl disabled:cursor-wait ${live ? 'bg-pink shadow-pink/40' : 'bg-brand shadow-brand/40'} ${arming ? 'opacity-70' : ''}`}
              >
                {live ? '⏹' : arming ? '…' : '🎤'}
              </motion.button>
            </div>

            <p className="mt-1 text-sm text-white/60" aria-live="polite">
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
            {speech.error && (
              <p className="mt-2 text-sm text-pink">{speech.error}</p>
            )}
            {live && speech.transcript && (
              <p className="mx-auto mt-3 max-w-xl text-sm text-white/40">
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
              <p className="mt-8 text-xs text-white/35">
                Playing as guest — sign in to save scores, streaks and XP.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
