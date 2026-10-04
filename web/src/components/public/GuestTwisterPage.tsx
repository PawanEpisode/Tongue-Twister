import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Lightbulb, Mic, Volume2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ErrorState, PracticeSkeleton } from '#/components/feedback'
import { DifficultyBadge } from '#/components/ui'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { DEMO_TWISTERS } from '#/content/demo'
import { api } from '#/lib/api'
import type { Twister } from '#/lib/api'
import { useGate } from '#/lib/gate/useGate'

/**
 * What a signed-out visitor sees on a twister page: the twister itself, how to say it, a Listen button
 * (the browser's own voice, no account and no microphone) and one clear way in. Practising is the gated step.
 */
export default function GuestTwisterPage({
  slug,
  initial,
}: {
  slug: string
  initial?: Twister | null
}) {
  const { request } = useGate()
  const {
    data: t,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['twister', slug],
    queryFn: () => api.twister(slug),
    initialData: initial ?? undefined,
  })
  const [canSpeak, setCanSpeak] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  useEffect(() => {
    setCanSpeak(typeof window !== 'undefined' && 'speechSynthesis' in window)
    return () => window.speechSynthesis?.cancel()
  }, [])

  if (isError)
    return (
      <ErrorState
        title={
          /API 404/.test(String(error.message))
            ? 'This twister was removed'
            : 'Couldn’t load this twister'
        }
        error={error}
        onRetry={() => void refetch()}
      >
        <Button asChild variant="outline">
          <Link to="/twisters">Browse twisters</Link>
        </Button>
      </ErrorState>
    )
  if (!t) return <PracticeSkeleton />

  const listen = () => {
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(t.text)
    u.rate = 0.85
    u.onend = u.onerror = () => setSpeaking(false)
    setSpeaking(true)
    synth.speak(u)
  }
  const isDemo = DEMO_TWISTERS.some((d) => d.slug === t.slug)

  return (
    <div className="mx-auto max-w-3xl py-4 text-center">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <DifficultyBadge level={t.difficulty} />
        <Badge variant="outline">
          {t.origin === 'classic' ? 'Classic' : 'Modern'}
        </Badge>
      </div>
      <h1 className="mt-6 font-display text-3xl leading-snug font-extrabold sm:text-5xl">
        {t.text}
      </h1>
      {t.tip && (
        <p className="mx-auto mt-5 flex max-w-xl items-start justify-center gap-2 text-muted-foreground">
          <Lightbulb
            className="mt-0.5 size-4 shrink-0 text-brand"
            aria-hidden
          />
          {t.tip}
        </p>
      )}
      {t.focus_sounds.length > 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Sounds to watch: {t.focus_sounds.map((s) => `“${s}”`).join(', ')}
        </p>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button
          size="lg"
          className="gap-2 shadow-lg shadow-primary/30"
          onClick={() => request({ intent: 'practise' })}
        >
          <Mic className="size-5" aria-hidden />
          Practise this twister
        </Button>
        {canSpeak && (
          <Button
            size="lg"
            variant="outline"
            className="gap-2"
            onClick={listen}
            disabled={speaking}
          >
            <Volume2 className="size-5" aria-hidden />
            {speaking ? 'Listening…' : 'Listen first'}
          </Button>
        )}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Free account, no card. Your score and streak are saved.
        {isDemo && (
          <>
            {' '}
            Or{' '}
            <Link to="/" hash="demo" className="underline underline-offset-4">
              try the instant demo
            </Link>{' '}
            first.
          </>
        )}
      </p>
    </div>
  )
}
