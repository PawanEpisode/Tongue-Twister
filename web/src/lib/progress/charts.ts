import type { ActivityDay } from '../api'

/**
 * Pure geometry and date maths behind the stats charts. No DOM and no timezone: API dates are the
 * user's own local dates (`YYYY-MM-DD`), so they are treated as plain calendar days (UTC arithmetic only).
 */

// ─── Scales and paths ───

export type Scale = (value: number) => number
export type Point = { x: number; y: number }

/** Maps `domain` onto `range`. A zero-width domain lands in the middle of the range. */
export function linearScale(
  [d0, d1]: readonly [number, number],
  [r0, r1]: readonly [number, number],
): Scale {
  if (d1 === d0) return () => (r0 + r1) / 2
  return (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0)
}

export type BandScale = {
  /** Left edge of band `i`. */
  x: (i: number) => number
  bandwidth: number
  step: number
}

/** `count` equal bands across `range`, with `padding` (0–1) of each step left empty. */
export function bandScale(
  count: number,
  [r0, r1]: readonly [number, number],
  padding = 0.2,
): BandScale {
  const step = count > 0 ? (r1 - r0) / count : 0
  const bandwidth = step * (1 - padding)
  const offset = (step - bandwidth) / 2
  return { x: (i) => r0 + i * step + offset, bandwidth, step }
}

/** 0 → a "nice" maximum at or above `max`, in about `count` round steps. */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1]
  const rough = max / count
  const pow = 10 ** Math.floor(Math.log10(rough))
  const unit = [1, 2, 5, 10].map((m) => m * pow).find((u) => u >= rough)!
  const ticks: number[] = []
  for (let v = 0; v < max + unit; v += unit) {
    ticks.push(Math.round(v * 1e6) / 1e6)
    if (v >= max) break
  }
  return ticks
}

/** Index of the position closest to `x` (positions ascending); -1 when there are none. */
export function nearestIndex(positions: readonly number[], x: number): number {
  let best = -1
  let bestDist = Infinity
  positions.forEach((p, i) => {
    const d = Math.abs(p - x)
    if (d < bestDist) {
      best = i
      bestDist = d
    }
  })
  return best
}

/** Up to `count` evenly spread indexes from 0 to `length - 1`, always including both ends. */
export function spreadIndexes(length: number, count: number): number[] {
  if (length <= 0) return []
  if (length <= count) return Array.from({ length }, (_, i) => i)
  return Array.from(
    new Set(
      Array.from({ length: count }, (_, i) =>
        Math.round((i * (length - 1)) / (count - 1)),
      ),
    ),
  )
}

const n1 = (v: number) => Math.round(v * 10) / 10

export function linePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${n1(p.x)},${n1(p.y)}`).join(' ')
}

/** The filled region between a line and a horizontal baseline. */
export function areaPath(points: readonly Point[], baselineY: number): string {
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return ''
  return `${linePath(points)} L${n1(last.x)},${n1(baselineY)} L${n1(first.x)},${n1(baselineY)} Z`
}

// ─── Display helpers ───

export type Trend = { delta: number; direction: 'up' | 'down' | 'flat' }

/** Change from the first to the last value, with changes under half a point called flat. */
export function trend(values: readonly number[]): Trend | null {
  if (values.length < 2) return null
  const delta = n1(values[values.length - 1] - values[0])
  return {
    delta,
    direction: Math.abs(delta) < 0.5 ? 'flat' : delta > 0 ? 'up' : 'down',
  }
}

export function trendCopy(t: Trend | null, noun = 'points'): string {
  if (!t) return ''
  if (t.direction === 'flat') return 'Holding steady'
  const amount = Math.abs(Math.round(t.delta))
  return t.direction === 'up'
    ? `Up ${amount} ${noun} over this period`
    : `Down ${amount} ${noun} over this period`
}

// ─── Calendar days ───

const DAY_MS = 86_400_000

/** Whole days since 1970-01-01 for a `YYYY-MM-DD` string. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

export function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10)
}

export const addDays = (iso: string, days: number): string =>
  fromDayNumber(dayNumber(iso) + days)

/** 0 = Monday … 6 = Sunday. */
export function weekdayMon0(iso: string): number {
  return (((dayNumber(iso) + 3) % 7) + 7) % 7 // 1970-01-01 was a Thursday
}

/** "Sep 14" (or the locale's equivalent), never shifted by the viewer's timezone. */
export function formatDay(
  iso: string,
  locale?: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' },
): string {
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: 'UTC',
  }).format(new Date(dayNumber(iso) * DAY_MS))
}

// ─── Activity heatmap ───

export type HeatLevel = 0 | 1 | 2 | 3 | 4
export type HeatCell = {
  date: string
  level: HeatLevel
  attempts: number
  activeMs: number
  readAlongMs: number
  freezeUsed: boolean
  qualifiesStreak: boolean
}
export type HeatGrid = {
  /** Columns are weeks (oldest first); each has 7 slots, Monday first. `null` = outside the range. */
  weeks: (HeatCell | null)[][]
  /** The first column that starts a new month. */
  months: { week: number; label: string }[]
}

/** Intensity from what was done that day: scored attempts plus minutes of Read-along. */
export function dayLevel(
  d: Pick<ActivityDay, 'attempts' | 'active_ms' | 'read_along_ms'>,
): HeatLevel {
  const n = d.attempts + Math.round(d.read_along_ms / 60_000)
  if (n >= 8) return 4
  if (n >= 4) return 3
  if (n >= 2) return 2
  if (n >= 1 || d.active_ms > 0) return 1
  return 0
}

export const EMPTY_DAY = {
  attempts: 0,
  active_ms: 0,
  read_along_ms: 0,
  qualifies_streak: false,
  freeze_used: false,
} as const

export function heatmapGrid(
  days: readonly ActivityDay[],
  from: string,
  to: string,
  locale?: string,
): HeatGrid {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const start = dayNumber(from)
  const end = dayNumber(to)
  const gridStart = start - weekdayMon0(from)
  const weeks: (HeatCell | null)[][] = []
  for (let w = gridStart; w <= end; w += 7) {
    weeks.push(
      Array.from({ length: 7 }, (_, dow) => {
        const n = w + dow
        if (n < start || n > end) return null
        const date = fromDayNumber(n)
        const d = byDate.get(date) ?? { date, ...EMPTY_DAY }
        return {
          date,
          level: dayLevel(d),
          attempts: d.attempts,
          activeMs: d.active_ms,
          readAlongMs: d.read_along_ms,
          freezeUsed: d.freeze_used,
          qualifiesStreak: d.qualifies_streak,
        }
      }),
    )
  }
  const months: HeatGrid['months'] = []
  let lastMonth = ''
  weeks.forEach((week, i) => {
    const first = week.find((c) => c !== null)
    if (!first) return
    const month = first.date.slice(0, 7)
    if (month === lastMonth) return
    lastMonth = month
    months.push({
      week: i,
      label: formatDay(first.date, locale, { month: 'short' }),
    })
  })
  return { weeks, months }
}
