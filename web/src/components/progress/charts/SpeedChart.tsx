import type { Stats } from '#/lib/api'
import { niceTicks } from '#/lib/progress/charts'
import { formatScore } from '#/lib/progress/format'
import { LineChart } from './LineChart'

/** Average speed per day in words per minute; the axis grows to fit. */
export function SpeedChart({ series }: { series: Stats['speed_series'] }) {
  const ticks = niceTicks(Math.max(...series.map((p) => p.avg_wpm), 0))
  return (
    <LineChart
      data={series.map((p) => ({ date: p.date, dot: p.avg_wpm }))}
      yMax={ticks[ticks.length - 1] ?? 1}
      yTicks={ticks}
      label="Average speed by day, in words per minute"
      dotLabel="Words per minute"
      valueLabel={(p) => [`${formatScore(p.dot)} wpm`]}
    />
  )
}
