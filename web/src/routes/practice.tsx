import { useQueryClient } from '@tanstack/react-query'
import {
  Link,
  createFileRoute,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { PracticeSkeleton } from '#/components/feedback'
import NailedWordsPanel from '#/components/practice/words/NailedWordsPanel'
import PracticeTabs from '#/components/practice/words/PracticeTabs'
import SummaryHeader from '#/components/practice/words/SummaryHeader'
import SoundsPanel from '#/components/practice/words/SoundsPanel'
import WeakWordsPanel, {
  canDrill,
} from '#/components/practice/words/WeakWordsPanel'
import WordDrill from '#/components/practice/WordDrill'
import type { DrillItem } from '#/components/practice/WordDrill'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/lib/auth'
import { usePreferences } from '#/lib/preferences'
import { seo } from '#/lib/seo'
import { PracticeLockProvider } from '#/lib/tabLock'
import { useModelVoice } from '#/lib/useModelVoice'
import {
  invalidateWordQueues,
  useNailedWords,
  useWeakWords,
} from '#/lib/wordQueues'

const QUICK_DRILL_WORDS = 3
type TabId = 'weak' | 'nailed' | 'sounds'

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

function PracticePage() {
  const { session, loading } = useAuth()
  const userId = session?.user.id
  const here = useRouterState({ select: (s) => s.location.href })
  const { drill } = Route.useSearch()
  const nav = useNavigate({ from: Route.fullPath })
  const qc = useQueryClient()
  const { prefs } = usePreferences()
  const [tab, setTab] = useState<TabId>('weak')
  const [dueOnly, setDueOnly] = useState(false)
  const [items, setItems] = useState<DrillItem[] | null>(null)
  const autoStarted = useRef(false)

  const allWeak = useWeakWords(userId, false)
  const due = useWeakWords(userId, true)
  const weak = dueOnly ? due : allWeak
  const nailed = useNailedWords(userId)
  const voice = useModelVoice(prefs.accent_lang, prefs.tts_voice)
  const onHear = voice.supported ? (w: string) => voice.say(w, 1) : undefined
  const drillable = weak.items.filter(canDrill)

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
            void invalidateWordQueues(qc)
          }}
        />
      </PracticeLockProvider>
    )

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-center font-display text-3xl font-extrabold">
        Your practice
      </h1>
      {allWeak.query.isSuccess && nailed.query.isSuccess && (
        <SummaryHeader
          nailed={nailed.count}
          weak={allWeak.count}
          due={due.query.isSuccess ? due.count : 0}
        />
      )}
      <PracticeTabs
        tabs={[
          {
            id: 'weak',
            label: 'To work on',
            count: weak.query.isSuccess ? weak.count : undefined,
          },
          {
            id: 'nailed',
            label: 'Nailed',
            count: nailed.query.isSuccess ? nailed.count : undefined,
          },
          { id: 'sounds', label: 'Sounds' },
        ]}
        value={tab}
        onChange={(id) => setTab(id as TabId)}
      />
      {tab === 'weak' && (
        <WeakWordsPanel
          queue={weak}
          dueOnly={dueOnly}
          onDueOnly={setDueOnly}
          onDrill={setItems}
          onHear={onHear}
        />
      )}
      {tab === 'nailed' && <NailedWordsPanel queue={nailed} onHear={onHear} />}
      {tab === 'sounds' && <SoundsPanel userId={userId} />}
    </div>
  )
}
