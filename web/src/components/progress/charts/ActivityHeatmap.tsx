import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { HeatCell, HeatGrid, HeatLevel } from '#/lib/progress/charts'
import { addDays, formatDay } from '#/lib/progress/charts'
import { formatDuration, plural } from '#/lib/progress/format'
import { ChartTooltip, DataTable, LiveReadout } from './ChartParts'

const CELL = 16
const GAP = 4
const STEP = CELL + GAP
const LEFT = 30
const TOP = 18
const ROWS = 7
/** Any Monday: only used to get the locale's weekday names. */
const A_MONDAY = '2026-09-28'
/** One hue, light to dark, blended into the card surface: more activity = deeper colour. */
const LEVEL_FILL: Record<HeatLevel, string> = {
  0: 'var(--muted)',
  1: 'color-mix(in srgb, var(--brand) 30%, var(--muted))',
  2: 'color-mix(in srgb, var(--brand) 55%, var(--muted))',
  3: 'color-mix(in srgb, var(--brand) 80%, var(--muted))',
  4: 'var(--brand)',
}
const LEVEL_NAMES = ['No activity', 'A little', 'Some', 'A lot', 'The most']

/** A small diamond marks a day a streak freeze covered, so the state isn't colour-only. */
function FreezeMark({ x, y }: { x: number; y: number }) {
  const c = CELL / 2
  return (
    <path
      d={`M${x + c},${y + 3.5} L${x + CELL - 3.5},${y + c} L${x + c},${y + CELL - 3.5} L${x + 3.5},${y + c} Z`}
      fill="var(--cyan)"
      stroke="var(--card)"
      strokeWidth="1"
    />
  )
}

function describe(c: HeatCell): string[] {
  const parts: string[] = []
  parts.push(
    c.attempts || c.readAlongMs
      ? [
          c.attempts ? plural(c.attempts, 'attempt') : '',
          c.readAlongMs ? `${formatDuration(c.readAlongMs)} of read-along` : '',
        ]
          .filter(Boolean)
          .join(', ')
      : 'No practice',
  )
  if (c.freezeUsed) parts.push('Streak freeze used')
  else if (c.qualifiesStreak) parts.push('Counted toward your streak')
  return parts
}

/** Weeks across, Monday at the top. Hover, or use the arrow keys (left/right = week, up/down = day). */
export function ActivityHeatmap({
  grid,
  locale,
}: {
  grid: HeatGrid
  locale?: string
}) {
  const cells = useMemo(
    () => new Map(grid.weeks.flat().flatMap((c) => (c ? [[c.date, c]] : []))),
    [grid],
  )
  const dates = useMemo(() => [...cells.keys()].sort(), [cells])
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const active = activeDate ? cells.get(activeDate) : undefined
  const width = LEFT + grid.weeks.length * STEP
  const height = TOP + ROWS * STEP

  const move = (e: KeyboardEvent) => {
    const at = activeDate ?? dates[dates.length - 1]
    if (!at) return
    const delta: Record<string, number> = {
      ArrowLeft: -7,
      ArrowRight: 7,
      ArrowUp: -1,
      ArrowDown: 1,
    }
    if (e.key === 'Escape') return setActiveDate(null)
    const d = delta[e.key]
    if (d === undefined) return
    e.preventDefault()
    const next = addDays(at, d)
    if (cells.has(next)) setActiveDate(next)
  }
  const pos = (c: HeatCell) => {
    for (let w = 0; w < grid.weeks.length; w++) {
      const r = grid.weeks[w].indexOf(c)
      if (r >= 0) return { x: LEFT + w * STEP, y: TOP + r * STEP }
    }
    return { x: 0, y: 0 }
  }
  const tip = active ? pos(active) : null

  return (
    <div>
      <div
        className="relative overflow-x-auto rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        role="group"
        aria-label="Activity by day. Use the arrow keys to read each day: left and right move a week, up and down a day."
        tabIndex={0}
        onKeyDown={move}
        onFocus={() =>
          setActiveDate((d) => d ?? dates[dates.length - 1] ?? null)
        }
        onBlur={() => setActiveDate(null)}
      >
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Activity heatmap"
          className="block"
          onPointerLeave={() => setActiveDate(null)}
        >
          {grid.months.map((m) => (
            <text
              key={m.week}
              x={LEFT + m.week * STEP}
              y={11}
              fontSize="11"
              fill="var(--muted-foreground)"
            >
              {m.label}
            </text>
          ))}
          {[0, 2, 4].map((row) => (
            <text
              key={row}
              x={0}
              y={TOP + row * STEP + CELL / 2}
              dominantBaseline="middle"
              fontSize="10"
              fill="var(--muted-foreground)"
            >
              {formatDay(addDays(A_MONDAY, row), locale, {
                weekday: 'short',
              })}
            </text>
          ))}
          {grid.weeks.map((week, w) =>
            week.map((c, r) =>
              c ? (
                <g key={c.date} onPointerEnter={() => setActiveDate(c.date)}>
                  <rect
                    x={LEFT + w * STEP}
                    y={TOP + r * STEP}
                    width={CELL}
                    height={CELL}
                    rx={3}
                    fill={LEVEL_FILL[c.level]}
                    stroke={
                      activeDate === c.date ? 'var(--foreground)' : 'none'
                    }
                    strokeWidth="1.5"
                  />
                  {c.freezeUsed && (
                    <FreezeMark x={LEFT + w * STEP} y={TOP + r * STEP} />
                  )}
                </g>
              ) : null,
            ),
          )}
        </svg>
        {active && tip && (
          <ChartTooltip
            x={tip.x + CELL / 2}
            width={width}
            title={formatDay(active.date, locale, {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
            rows={describe(active)}
          />
        )}
      </div>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li
          className="inline-flex items-center gap-1"
          aria-label="Less to more activity"
        >
          Less
          {([0, 1, 2, 3, 4] as const).map((l) => (
            <svg key={l} width="14" height="14" aria-hidden>
              <rect width="14" height="14" rx="3" fill={LEVEL_FILL[l]} />
            </svg>
          ))}
          More
        </li>
        <li className="inline-flex items-center gap-1">
          <svg width="16" height="16" aria-hidden>
            <rect width="16" height="16" rx="3" fill={LEVEL_FILL[0]} />
            <FreezeMark x={0} y={0} />
          </svg>
          Streak freeze used
        </li>
      </ul>
      <LiveReadout
        text={
          active
            ? `${formatDay(active.date, locale)}: ${describe(active).join('. ')}`
            : ''
        }
      />
      <DataTable
        caption="Activity by day"
        headers={['Date', 'Activity', 'Level']}
        rows={dates.map((d) => {
          const c = cells.get(d)!
          return [
            formatDay(d, locale),
            describe(c).join('. '),
            LEVEL_NAMES[c.level],
          ]
        })}
      />
    </div>
  )
}
