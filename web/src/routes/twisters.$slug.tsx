import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import ModeSwitcher, { BUILT_MODES } from '#/components/practice/ModeSwitcher'
import type { ModeKey } from '#/components/practice/ModeSwitcher'
import ReadAlongMode from '#/components/practice/ReadAlongMode'
import HubHeader from '#/components/practice/HubHeader'
import RecordEntry from '#/components/practice/record/RecordEntry'
import SidePanel from '#/components/practice/SidePanel'
import SpeakAndScore from '#/components/practice/SpeakAndScore'
import TrainMode from '#/components/practice/TrainMode'
import { Button } from '#/components/ui/button'
import { ErrorState, PracticeSkeleton } from '#/components/feedback'
import { api } from '#/lib/api'
import type { DisplayStyle, PracticeMode } from '#/lib/api'
import { useFlags } from '#/lib/flags'
import { PracticeLockProvider } from '#/lib/tabLock'
import { usePreferences } from '#/lib/preferences'
import { clampWpm } from '#/lib/readAlong/timeline'
import { useRecordSupport } from '#/lib/record/useRecordSupport'
import { seo } from '#/lib/seo'

const MODE_OF: Record<PracticeMode, ModeKey | undefined> = {
  read_along: 'read',
  speak_score: 'speak',
  record: 'record',
}
// Train is a way of practising speaking, so it is remembered as (and reopens on) Speak & score.
const PREF_OF: Record<ModeKey, PracticeMode> = {
  read: 'read_along',
  speak: 'speak_score',
  train: 'speak_score',
  record: 'record',
}
const STYLES: DisplayStyle[] = ['word', 'line', 'scroll']

type Search = { mode?: ModeKey; wpm?: number; style?: DisplayStyle }

/** Deep links (?mode=read&wpm=110&style=line). Anything invalid is dropped silently (PRD 01 H2). */
function parseSearch(raw: Record<string, unknown>): Search {
  const mode = BUILT_MODES.find((m) => m === raw.mode)
  const wpm = Number(raw.wpm)
  const style = STYLES.find((s) => s === raw.style)
  return {
    ...(mode && { mode }),
    ...(Number.isFinite(wpm) &&
      raw.wpm !== '' &&
      raw.wpm != null && { wpm: clampWpm(wpm) }),
    ...(style && { style }),
  }
}

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
  validateSearch: parseSearch,
  component: PracticeHub,
})

function PracticeHub() {
  const { slug } = Route.useParams()
  const search = Route.useSearch()
  const nav = useNavigate({ from: Route.fullPath })
  const { prefs, update, sync, ready } = usePreferences()
  const flags = useFlags()
  const canRecord = useRecordSupport()
  const {
    data: t,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['twister', slug],
    queryFn: () => api.twister(slug),
  })

  // Built ∩ flagged on. With the hub flag off, only the original Speak flow remains.
  const enabled = BUILT_MODES.filter(
    (m) =>
      (flags.practice_hub &&
        (m !== 'read' || flags.read_along) &&
        (m !== 'train' || flags.speak_v2) &&
        (m !== 'record' || (flags.record_local && canRecord))) ||
      m === 'speak',
  )
  const remembered = MODE_OF[prefs.default_mode]
  const wanted = search.mode ?? remembered
  const mode: ModeKey = wanted && enabled.includes(wanted) ? wanted : 'speak'

  // Switching remembers the choice; the old mode unmounts, which releases mic streams and closes its session.
  const switchMode = (next: ModeKey) => {
    if (next !== 'train') update({ default_mode: PREF_OF[next] })
    void nav({ search: (s) => ({ ...s, mode: next }), replace: true })
  }

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
  if (!t || !ready) return <PracticeSkeleton />

  return (
    <PracticeLockProvider>
      <div className="mx-auto max-w-3xl text-center">
        <HubHeader twister={t} settingsNotSynced={sync === 'error'} />
        {enabled.length > 1 && (
          <ModeSwitcher mode={mode} enabled={enabled} onChange={switchMode} />
        )}

        <div
          id="practice-stage"
          role="tabpanel"
          aria-labelledby={`tab-${mode}`}
        >
          {mode === 'read' ? (
            <ReadAlongMode
              key={t.slug}
              twister={t}
              prefs={prefs}
              update={update}
              overrides={{ wpm: search.wpm, style: search.style }}
              onSwitchMode={() => switchMode('speak')}
            />
          ) : mode === 'record' ? (
            <RecordEntry
              key={t.slug}
              twister={t}
              prefs={prefs}
              onSwitchMode={() => switchMode('speak')}
            />
          ) : mode === 'train' ? (
            <TrainMode
              key={t.slug}
              twister={t}
              prefs={prefs}
              onSwitchMode={() => switchMode('speak')}
            />
          ) : (
            <SpeakAndScore
              key={t.slug}
              t={t}
              onReadAlong={() => switchMode('read')}
            />
          )}
        </div>
        <SidePanel twister={t} />
      </div>
    </PracticeLockProvider>
  )
}
