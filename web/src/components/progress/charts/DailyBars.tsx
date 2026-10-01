import {
  bandScale,
  formatDay,
  linearScale,
  nearestIndex,
  niceTicks,
} from '#/lib/progress/charts'
import { ChartTooltip, DataTable, LiveReadout } from './ChartParts'
import { useActivePoint } from './useActivePoint'
import { useChartWidth } from './useChartWidth'

export type Bar = { date: string; value: number; text: string }

const M = { t: 12, r: 10, b: 26, l: 34 }

/** One bar per day. Values come pre-described (`text`) so the same chart serves attempts and minutes. */
export function DailyBars({
  bars,
  label,
  unit,
}: {
  bars: Bar[]
  label: string
  /** Column header for the table, e.g. "Attempts". */
  unit: string
}) {
  const { ref, width } = useChartWidth()
  const height = width < 420 ? 170 : 200
  const { active, setActive, keyProps } = useActivePoint(bars.length)
  const ticks = niceTicks(Math.max(...bars.map((b) => b.value), 1), 3)
  const y = linearScale([0, ticks[ticks.length - 1] ?? 1], [height - M.b, M.t])
  const band = bandScale(bars.length, [M.l, width - M.r], 0.25)
  const centres = bars.map((_, i) => band.x(i) + band.bandwidth / 2)
  const current = active !== null ? bars[active] : undefined
  // A very long range gets thin bars; the unit-width floor keeps them visible.
  const barW = Math.max(band.bandwidth, 2)

  return (
    <div>
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
            setActive(nearestIndex(centres, e.clientX - box.left))
          }}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={M.l}
                x2={width - M.r}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--border)"
                opacity={t === 0 ? 1 : 0.6}
              />
              <text
                x={M.l - 8}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="11"
                fill="var(--muted-foreground)"
              >
                {t}
              </text>
            </g>
          ))}
          {bars.map((b, i) => (
            <rect
              key={b.date}
              x={centres[i] - barW / 2}
              y={y(b.value)}
              width={barW}
              height={Math.max(0, y(0) - y(b.value))}
              rx={Math.min(4, barW / 2)}
              fill="var(--brand)"
              opacity={active === null || active === i ? 1 : 0.55}
              stroke={active === i ? 'var(--foreground)' : 'none'}
              strokeWidth="1.5"
            />
          ))}
          {bars.length > 0 && (
            <>
              <text
                x={centres[0]}
                y={height - 8}
                fontSize="11"
                fill="var(--muted-foreground)"
                textAnchor="start"
              >
                {formatDay(bars[0].date)}
              </text>
              {bars.length > 1 && (
                <text
                  x={centres[bars.length - 1]}
                  y={height - 8}
                  fontSize="11"
                  fill="var(--muted-foreground)"
                  textAnchor="end"
                >
                  {formatDay(bars[bars.length - 1].date)}
                </text>
              )}
            </>
          )}
        </svg>
        {current && active !== null && (
          <ChartTooltip
            x={centres[active]}
            width={width}
            title={formatDay(current.date)}
            rows={[current.text]}
          />
        )}
      </div>
      <LiveReadout
        text={current ? `${formatDay(current.date)}: ${current.text}` : ''}
      />
      <DataTable
        caption={label}
        headers={['Date', unit]}
        rows={bars.map((b) => [formatDay(b.date), b.text])}
      />
    </div>
  )
}
