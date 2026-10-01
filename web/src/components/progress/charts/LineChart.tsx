import { useMemo } from 'react'
import {
  dayNumber,
  formatDay,
  linePath,
  linearScale,
  nearestIndex,
  spreadIndexes,
} from '#/lib/progress/charts'
import type { Point } from '#/lib/progress/charts'
import { ChartTooltip, DataTable, Legend, LiveReadout } from './ChartParts'
import { useActivePoint } from './useActivePoint'
import { useChartWidth } from './useChartWidth'

export type LinePoint = {
  date: string
  /** Plotted as a dot. */
  dot: number
  /** Plotted as the connecting line (e.g. a rolling mean). Without any, dots are joined instead. */
  line?: number
}

const M = { t: 12, r: 14, b: 26, l: 40 }
const DOT_R = 4
const X_TICKS = 4

/** A dated series: dots for the raw values, optionally a smoothed line. Hover, arrow keys and a table all reach every point. */
export function LineChart({
  data,
  yMax,
  yTicks,
  yFormat = String,
  label,
  dotLabel,
  lineLabel,
  valueLabel,
}: {
  data: LinePoint[]
  yMax: number
  yTicks: number[]
  yFormat?: (v: number) => string
  /** Names the chart for assistive tech and the table caption. */
  label: string
  dotLabel: string
  lineLabel?: string
  /** Describes one point, e.g. ["Average 72", "7-day average 70"]. */
  valueLabel: (p: LinePoint) => string[]
}) {
  const { ref, width } = useChartWidth()
  const height = width < 420 ? 190 : 230
  const { active, setActive, keyProps } = useActivePoint(data.length)

  const geo = useMemo(() => {
    const days = data.map((d) => dayNumber(d.date))
    const x = linearScale(
      [days[0] ?? 0, days[days.length - 1] ?? 0],
      [M.l, width - M.r],
    )
    const y = linearScale([0, yMax], [height - M.b, M.t])
    const xs = days.map(x)
    const dots: Point[] = data.map((d, i) => ({ x: xs[i], y: y(d.dot) }))
    const linePts: Point[] = data.map((d, i) => ({
      x: xs[i],
      y: y(d.line ?? d.dot),
    }))
    return { xs, y, dots, linePts }
  }, [data, width, height, yMax])

  const hasLine = data.some((d) => d.line !== undefined)
  const current = active !== null ? data[active] : undefined
  const describe = (p: LinePoint) =>
    `${formatDay(p.date)}: ${valueLabel(p).join(', ')}`

  return (
    <div>
      {hasLine && lineLabel && (
        <Legend
          items={[
            {
              label: dotLabel,
              swatch: <circle cx="9" cy="5" r="3.5" fill="var(--cyan)" />,
            },
            {
              label: lineLabel,
              swatch: (
                <line
                  x1="0"
                  x2="18"
                  y1="5"
                  y2="5"
                  stroke="var(--brand)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ),
            },
          ]}
        />
      )}
      <div
        ref={ref}
        className="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        role="group"
        aria-label={`${label}. Use the left and right arrow keys to read each day.`}
        {...keyProps}
      >
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          className="block max-w-full touch-pan-y"
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            setActive(nearestIndex(geo.xs, e.clientX - box.left))
          }}
          onPointerLeave={() => setActive(null)}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={M.l}
                x2={width - M.r}
                y1={geo.y(t)}
                y2={geo.y(t)}
                stroke="var(--border)"
                strokeWidth="1"
                opacity={t === 0 ? 1 : 0.6}
              />
              <text
                x={M.l - 8}
                y={geo.y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="11"
                fill="var(--muted-foreground)"
              >
                {yFormat(t)}
              </text>
            </g>
          ))}
          {spreadIndexes(data.length, X_TICKS).map((i) => (
            <text
              key={i}
              x={geo.xs[i]}
              y={height - 8}
              textAnchor={
                i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'
              }
              fontSize="11"
              fill="var(--muted-foreground)"
            >
              {formatDay(data[i].date)}
            </text>
          ))}
          {active !== null && (
            <line
              x1={geo.xs[active]}
              x2={geo.xs[active]}
              y1={M.t}
              y2={height - M.b}
              stroke="var(--muted-foreground)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}
          {data.length > 1 && (
            <path
              d={linePath(hasLine ? geo.linePts : geo.dots)}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {geo.dots.map((p, i) => (
            <circle
              key={data[i].date}
              cx={p.x}
              cy={p.y}
              r={active === i ? DOT_R + 1.5 : DOT_R}
              fill={hasLine ? 'var(--cyan)' : 'var(--brand)'}
              stroke="var(--card)"
              strokeWidth="2"
            />
          ))}
        </svg>
        {current && active !== null && (
          <ChartTooltip
            x={geo.xs[active]}
            width={width}
            title={formatDay(current.date)}
            rows={valueLabel(current)}
          />
        )}
      </div>
      <LiveReadout text={current ? describe(current) : ''} />
      <DataTable
        caption={label}
        headers={[
          'Date',
          dotLabel,
          ...(hasLine && lineLabel ? [lineLabel] : []),
        ]}
        rows={data.map((p) => [
          formatDay(p.date),
          yFormat(p.dot),
          ...(hasLine && lineLabel ? [yFormat(p.line ?? p.dot)] : []),
        ])}
      />
    </div>
  )
}
