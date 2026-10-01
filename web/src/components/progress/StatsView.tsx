import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ErrorState, Skeleton } from '#/components/feedback'
import { Card } from '#/components/ui/card'
import { Chip } from '#/components/ui/chip'
import { api } from '#/lib/api'
import type { Stats, StatsMode, StatsRange } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { trend, trendCopy } from '#/lib/progress/charts'
import { formatDuration, formatScore, plural } from '#/lib/progress/format'
import {
  MODE_LABELS,
  RANGE_LABELS,
  STATS_MODES,
  STATS_RANGES,
} from '#/lib/progress/statsParams'
import { AchievementsSection } from './AchievementsSection'
import { ActivityCard } from './ActivityCard'
import { BarList } from './charts/BarList'
import { ChartCard } from './charts/ChartParts'
import { DailyBars } from './charts/DailyBars'
import { ScoreChart } from './charts/ScoreChart'
import { SpeedChart } from './charts/SpeedChart'
import { WeakWordsCard } from './WeakWordsCard'

function Kpi({
  label,
  value,
  sub,
}: {
  label: string
  value: ReactNode
  sub?: string
}) {
  return (
    <Card variant="glass" className="rounded-2xl p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 font-display text-2xl font-extrabold">{value}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </Card>
  )
}

function Kpis({ k }: { k: Stats['kpis'] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Kpi label="Attempts" value={k.attempts} />
      <Kpi label="Practice time" value={formatDuration(k.practice_ms)} />
      <Kpi label="Average score" value={formatScore(k.avg_score)} />
      <Kpi label="Best streak" value={plural(k.best_streak, 'day')} />
      <Kpi label="Mastered" value={k.mastered} />
      <Kpi label="Level" value={k.level} sub={`${k.xp} XP`} />
    </dl>
  )
}

function StatsSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading your stats">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i} variant="glass" className="rounded-2xl p-4" aria-hidden>
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-7 w-14" />
          </Card>
        ))}
      </div>
      {Array.from({ length: 2 }, (_, i) => (
        <Card key={i} variant="glass" className="rounded-2xl p-5" aria-hidden>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-48 w-full" />
        </Card>
      ))}
    </div>
  )
}

const NO_SCORES =
  'No scored attempts in this period yet. Say a twister out loud and your scores land here.'

function Charts({ s, mode }: { s: Stats; mode?: StatsMode }) {
  const readAlong = mode === 'read_along'
  const rolling = trend(s.score_series.map((p) => p.rolling))
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Score over time"
        description={trendCopy(rolling) || 'Your average score by day.'}
        empty={
          readAlong
            ? 'Read-along isn’t scored, so there’s no score chart for it. Try Speak & score or Record.'
            : s.score_series.length
              ? undefined
              : NO_SCORES
        }
      >
        <ScoreChart series={s.score_series} />
      </ChartCard>
      <ChartCard
        title="Speed"
        description="Words per minute, by day."
        empty={
          readAlong
            ? 'Speed comes from scored attempts, which Read-along doesn’t have.'
            : s.speed_series.length
              ? undefined
              : NO_SCORES
        }
      >
        <SpeedChart series={s.speed_series} />
      </ChartCard>
      <ChartCard
        title={readAlong ? 'Read-along time' : 'Practice per day'}
        description={
          readAlong ? 'Minutes spent reading along.' : 'Attempts by day.'
        }
        empty={
          s.attempts_by_day.length
            ? undefined
            : 'Nothing practised in this period yet.'
        }
      >
        <DailyBars
          label={readAlong ? 'Read-along minutes by day' : 'Attempts by day'}
          unit={readAlong ? 'Read-along' : 'Attempts'}
          bars={s.attempts_by_day.map((d) => ({
            date: d.date,
            value: readAlong ? d.active_ms / 60_000 : d.attempts,
            text: readAlong
              ? formatDuration(d.active_ms)
              : `${plural(d.attempts, 'attempt')} · ${formatDuration(d.active_ms)}`,
          }))}
        />
      </ChartCard>
      <ChartCard
        title="Accuracy by sound family"
        description="Weakest first, so you know where to aim."
        empty={
          s.category_accuracy.length
            ? undefined
            : 'Sound-family accuracy appears after a few scored attempts.'
        }
      >
        <BarList rows={s.category_accuracy} />
      </ChartCard>
    </div>
  )
}

/** The whole /stats body for a signed-in learner: controls, KPIs, charts, weak words, achievements. */
export function StatsView({
  range,
  mode,
  onChange,
}: {
  range: StatsRange
  mode?: StatsMode
  onChange: (next: { range?: StatsRange; mode?: StatsMode | undefined }) => void
}) {
  const { session } = useAuth()
  const q = useQuery({
    queryKey: ['stats', session?.user.id, range, mode],
    queryFn: () => api.stats(range, mode),
    enabled: !!session,
  })

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-4xl font-extrabold">Your progress</h1>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Time range" className="flex gap-2">
            {STATS_RANGES.map((r) => (
              <Chip
                key={r}
                on={range === r}
                onClick={() => onChange({ range: r })}
              >
                {RANGE_LABELS[r]}
              </Chip>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Mode
            <select
              value={mode ?? ''}
              onChange={(e) =>
                onChange({
                  mode: STATS_MODES.find((m) => m === e.target.value),
                })
              }
              className="min-h-9 rounded-xl border border-border bg-card px-3 py-1.5 text-foreground pointer-coarse:min-h-11"
            >
              <option value="">All modes</option>
              {STATS_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {q.isPending ? (
        <StatsSkeleton />
      ) : q.isError ? (
        <ErrorState
          title="Couldn’t load your stats"
          error={q.error}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          <Kpis k={q.data.kpis} />
          {q.data.kpis.attempts === 0 && q.data.kpis.practice_ms === 0 && (
            <p className="text-muted-foreground">
              Nothing in this period yet. Pick a twister and your numbers start
              here.
            </p>
          )}
          <Charts s={q.data} mode={mode} />
          <WeakWordsCard words={q.data.weak_words} />
        </>
      )}
      <ActivityCard />
      <AchievementsSection />
    </div>
  )
}
