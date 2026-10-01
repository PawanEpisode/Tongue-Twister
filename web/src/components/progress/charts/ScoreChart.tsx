import type { Stats } from '#/lib/api'
import { formatScore } from '#/lib/progress/format'
import { LineChart } from './LineChart'
import type { LinePoint } from './LineChart'

const TICKS = [0, 25, 50, 75, 100]

/** Daily average score (dots) and the 7-day rolling average (line), on a fixed 0–100 axis. */
export function ScoreChart({ series }: { series: Stats['score_series'] }) {
  const data: LinePoint[] = series.map((p) => ({
    date: p.date,
    dot: p.avg,
    line: p.rolling,
  }))
  return (
    <LineChart
      data={data}
      yMax={100}
      yTicks={TICKS}
      yFormat={(v) => formatScore(v)}
      label="Average score by day"
      dotLabel="Daily average"
      lineLabel="7-day average"
      valueLabel={(p) => {
        const count = series.find((s) => s.date === p.date)?.count ?? 0
        return [
          `Average ${formatScore(p.dot)} (${count} ${count === 1 ? 'attempt' : 'attempts'})`,
          `7-day average ${formatScore(p.line ?? p.dot)}`,
        ]
      }}
    />
  )
}
