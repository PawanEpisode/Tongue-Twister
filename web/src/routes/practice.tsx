import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { PracticeSkeleton } from '#/components/feedback'
import WordDrill from '#/components/practice/WordDrill'
import type { DrillItem } from '#/components/practice/WordDrill'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import { api } from '#/lib/api'
import type { WeakWord } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { dueLabel } from '#/lib/dueLabel'
import { usePreferences } from '#/lib/preferences'
import { seo } from '#/lib/seo'
import { PracticeLockProvider } from '#/lib/tabLock'

const QUICK_DRILL_WORDS = 3
const LIST_SIZE = 20

export const Route = createFileRoute('/practice')({
  head: () =>
    seo({
      title: 'Your practice | Twister',
      description: 'Your weakest words and sounds, and drills to fix them.',
      path: '/practice',
      noindex: true,
    }),
  // /practice?drill=1 starts a drill of the weakest words straight away (linked from the results screen).
  validateSearch: (raw: Record<string, unknown>): { drill?: 1 } =>
    Number(raw.drill) === 1 || raw.drill === 'true' ? { drill: 1 } : {},
  component: PracticePage,
})

const canDrill = (w: WeakWord): w is DrillItem => w.drill !== null

function PracticePage() {
  const { session, loading } = useAuth()
  const userId = session?.user.id
  const here = useRouterState({ select: (s) => s.location.href })
  const { drill } = Route.useSearch()
  const nav = useNavigate({ from: Route.fullPath })
  const qc = useQueryClient()
  const { prefs } = usePreferences()
  const [dueOnly, setDueOnly] = useState(false)
  const [items, setItems] = useState<DrillItem[] | null>(null)
  const autoStarted = useRef(false)
  const dueId = useId()

  const words = useQuery({
    queryKey: ['weak-words', userId, dueOnly],
    queryFn: () => api.weakWords({ due: dueOnly, limit: LIST_SIZE }),
    enabled: !!userId,
  })
  const sounds = useQuery({
    queryKey: ['weak-sounds', userId],
    queryFn: () => api.weakSounds(8),
    enabled: !!userId,
  })
  const drillable = useMemo(
    () => (words.data ?? []).filter(canDrill),
    [words.data],
  )

  // Arrive from the results screen: start on the weakest words once, then drop the flag from the URL.
  useEffect(() => {
    if (!drill || autoStarted.current || !drillable.length) return
    autoStarted.current = true
    setItems(drillable.slice(0, QUICK_DRILL_WORDS))
    void nav({ search: {}, replace: true })
  }, [drill, drillable, nav])

  if (loading) return <PracticeSkeleton />
  if (!session)
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-bold">Your practice</h1>
        <p className="mt-2 text-muted-foreground">
          Sign in to see the words and sounds you struggle with and drill them.
        </p>
        <Button asChild className="mt-6 px-6 py-3">
          <Link to="/login" search={{ redirect: here }}>
            Sign in
          </Link>
        </Button>
      </div>
    )

  if (items)
    return (
      <PracticeLockProvider>
        <WordDrill
          items={items}
          prefs={prefs}
          onExit={() => {
            setItems(null)
            void qc.invalidateQueries({ queryKey: ['weak-words'] })
          }}
        />
      </PracticeLockProvider>
    )

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-center font-display text-3xl font-extrabold">
        Your practice
      </h1>

      <section aria-labelledby="weak-words" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="weak-words" className="text-xl font-bold">
            Words to work on
          </h2>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              id={dueId}
              checked={dueOnly}
              onCheckedChange={(value) => setDueOnly(value === true)}
            />
            <Label
              htmlFor={dueId}
              className="font-normal text-muted-foreground"
            >
              Due for review only
            </Label>
          </div>
        </div>

        {words.isPending ? (
          <p className="mt-4 text-muted-foreground">Loading…</p>
        ) : words.isError ? (
          <p role="alert" className="mt-4 text-pink">
            Couldn’t load your words.{' '}
            <button className="underline" onClick={() => void words.refetch()}>
              Try again
            </button>
          </p>
        ) : words.data.length === 0 ? (
          <p className="mt-4 text-muted-foreground">
            {dueOnly
              ? 'Nothing is due for review right now.'
              : 'No trouble words yet — say a few twisters and the ones you trip on will show up here.'}
          </p>
        ) : (
          <>
            {drillable.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  className="px-5 py-2.5"
                  onClick={() =>
                    setItems(drillable.slice(0, QUICK_DRILL_WORDS))
                  }
                >
                  Drill my {Math.min(QUICK_DRILL_WORDS, drillable.length)}{' '}
                  weakest
                </Button>
                {drillable.length > QUICK_DRILL_WORDS && (
                  <Button
                    variant="outline"
                    className="px-5 py-2.5"
                    onClick={() => setItems(drillable)}
                  >
                    Drill all {drillable.length}
                  </Button>
                )}
              </div>
            )}
            <ul className="mt-4 space-y-2">
              {words.data.map((w) => (
                <li
                  key={w.word}
                  className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
                >
                  <div>
                    <b className="text-lg">{w.word}</b>
                    {w.respelling && (
                      <span className="ml-2 text-sm text-muted-foreground">
                        {w.respelling}
                      </span>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Missed {Math.round(w.miss_rate * 100)}% of {w.seen}{' '}
                      {w.seen === 1 ? 'time' : 'times'} ·{' '}
                      {dueLabel(w.next_review_at)}
                    </p>
                  </div>
                  {canDrill(w) && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setItems([w])}
                      aria-label={`Drill ${w.word}`}
                    >
                      Drill
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="weak-sounds" className="mt-10">
        <h2 id="weak-sounds" className="text-xl font-bold">
          Sounds you swap
        </h2>
        {sounds.isPending ? (
          <p className="mt-4 text-muted-foreground">Loading…</p>
        ) : sounds.isError ? (
          <p role="alert" className="mt-4 text-pink">
            Couldn’t load your sounds.
          </p>
        ) : sounds.data.length === 0 ? (
          <p className="mt-4 text-muted-foreground">
            Sound-by-sound feedback (like “you say s where it should be sh”)
            arrives with the accurate engine. Until then, your words above are
            the best guide.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {sounds.data.map((s) => (
              <li
                key={s.pair}
                className="glass flex items-center justify-between rounded-2xl px-4 py-3"
              >
                <span>
                  <b>{s.target}</b> → <b>{s.heard ?? 'dropped'}</b>
                </span>
                <span className="text-sm text-muted-foreground">
                  {Math.round(s.error_rate * 100)}% of {s.occurrences}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
