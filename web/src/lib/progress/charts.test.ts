import { describe, expect, it } from 'vitest'
import type { ActivityDay } from '../api'
import {
  addDays,
  areaPath,
  bandScale,
  dayLevel,
  dayNumber,
  formatDay,
  heatmapGrid,
  linePath,
  linearScale,
  nearestIndex,
  spreadIndexes,
  niceTicks,
  trend,
  trendCopy,
  weekdayMon0,
} from './charts'

describe('linearScale', () => {
  it('maps the domain onto the range', () => {
    const y = linearScale([0, 100], [200, 0])
    expect(y(0)).toBe(200)
    expect(y(50)).toBe(100)
    expect(y(100)).toBe(0)
  })
  it('puts a single-value domain in the middle', () => {
    expect(linearScale([5, 5], [0, 100])(5)).toBe(50)
  })
})

describe('bandScale', () => {
  it('splits the range into padded bands', () => {
    const b = bandScale(4, [0, 100], 0.2)
    expect(b.step).toBe(25)
    expect(b.bandwidth).toBe(20)
    expect(b.x(0)).toBe(2.5)
    expect(b.x(3)).toBe(77.5)
  })
  it('copes with no bands', () => {
    expect(bandScale(0, [0, 100]).step).toBe(0)
  })
})

describe('niceTicks', () => {
  it('rounds the top up to a friendly number', () => {
    expect(niceTicks(187)).toEqual([0, 50, 100, 150, 200])
    expect(niceTicks(9, 3)).toEqual([0, 5, 10])
  })
  it('handles nothing to plot', () => {
    expect(niceTicks(0)).toEqual([0, 1])
  })
})

describe('paths', () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 10.04, y: 20 },
  ]
  it('builds a polyline', () => {
    expect(linePath(pts)).toBe('M0,10 L10,20')
    expect(linePath([])).toBe('')
  })
  it('closes an area down to the baseline', () => {
    expect(areaPath(pts, 50)).toBe('M0,10 L10,20 L10,50 L0,50 Z')
    expect(areaPath([], 50)).toBe('')
  })
})

describe('trend', () => {
  it('needs two values', () => {
    expect(trend([70])).toBeNull()
    expect(trendCopy(null)).toBe('')
  })
  it('names direction and size', () => {
    expect(trendCopy(trend([60, 66]))).toBe('Up 6 points over this period')
    expect(trendCopy(trend([70, 64]))).toBe('Down 6 points over this period')
    expect(trendCopy(trend([70, 70.2]))).toBe('Holding steady')
  })
})

describe('calendar maths', () => {
  it('knows the weekday, Monday first', () => {
    expect(weekdayMon0('2026-10-01')).toBe(3) // Thursday
    expect(weekdayMon0('2026-09-28')).toBe(0) // Monday
    expect(weekdayMon0('2026-10-04')).toBe(6) // Sunday
    expect(weekdayMon0('1970-01-01')).toBe(3)
    expect(weekdayMon0('1969-12-28')).toBe(6)
  })
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(dayNumber('2026-10-02') - dayNumber('2026-10-01')).toBe(1)
  })
  it('formats a day without shifting it by timezone', () => {
    expect(formatDay('2026-10-01', 'en-US')).toBe('Oct 1')
    expect(formatDay('2026-01-01', 'en-US')).toBe('Jan 1')
  })
})

const day = (date: string, over: Partial<ActivityDay> = {}): ActivityDay => ({
  date,
  attempts: 0,
  active_ms: 0,
  read_along_ms: 0,
  qualifies_streak: false,
  freeze_used: false,
  ...over,
})

describe('dayLevel', () => {
  it.each([
    [{ attempts: 0, active_ms: 0, read_along_ms: 0 }, 0],
    [{ attempts: 1, active_ms: 0, read_along_ms: 0 }, 1],
    [{ attempts: 0, active_ms: 500, read_along_ms: 0 }, 1],
    [{ attempts: 2, active_ms: 0, read_along_ms: 0 }, 2],
    [{ attempts: 3, active_ms: 0, read_along_ms: 0 }, 2],
    [{ attempts: 4, active_ms: 0, read_along_ms: 0 }, 3],
    [{ attempts: 1, active_ms: 0, read_along_ms: 6 * 60_000 }, 3],
    [{ attempts: 8, active_ms: 0, read_along_ms: 0 }, 4],
  ] as const)('%j -> level %d', (d, level) => {
    expect(dayLevel(d)).toBe(level)
  })
})

describe('heatmapGrid', () => {
  it('lays weeks out Monday-first and blanks days outside the range', () => {
    // Thu 2026-10-01 back to Mon 2026-09-14: three weeks, the last one partial
    const g = heatmapGrid(
      [day('2026-09-28', { attempts: 5 })],
      '2026-09-14',
      '2026-10-01',
      'en-US',
    )
    expect(g.weeks).toHaveLength(3)
    expect(g.weeks.every((w) => w.length === 7)).toBe(true)
    expect(g.weeks[0][0]?.date).toBe('2026-09-14')
    expect(g.weeks[2][0]?.date).toBe('2026-09-28')
    expect(g.weeks[2][0]?.level).toBe(3)
    expect(g.weeks[2][3]?.date).toBe('2026-10-01')
    expect(g.weeks[2][4]).toBeNull()
    expect(g.weeks[2][6]).toBeNull()
  })
  it('starts mid-week when the range does (Sunday start keeps its column)', () => {
    // Sun 2026-09-27 is the last slot of its week
    const g = heatmapGrid([], '2026-09-27', '2026-09-29', 'en-US')
    expect(g.weeks[0].slice(0, 6).every((c) => c === null)).toBe(true)
    expect(g.weeks[0][6]?.date).toBe('2026-09-27')
    expect(g.weeks[1][0]?.date).toBe('2026-09-28')
    expect(g.weeks[1][1]?.date).toBe('2026-09-29')
  })
  it('fills days without a row as empty and keeps freeze days visible', () => {
    const g = heatmapGrid(
      [day('2026-09-15', { freeze_used: true })],
      '2026-09-14',
      '2026-09-16',
      'en-US',
    )
    expect(g.weeks[0][0]).toMatchObject({ level: 0, attempts: 0 })
    expect(g.weeks[0][1]).toMatchObject({ level: 0, freezeUsed: true })
  })
  it('labels the first column of each month, across a month boundary', () => {
    const g = heatmapGrid([], '2026-07-13', '2026-10-01', 'en-US')
    // A month is labelled on the first column that begins in it; the last column (Mon Sep 28) still begins in September.
    expect(g.months.map((m) => m.label)).toEqual(['Jul', 'Aug', 'Sep'])
    expect(g.months[0].week).toBe(0)
    expect(g.weeks[g.months[1].week][0]!.date).toBe('2026-08-03')
  })
  it('handles a range inside a single day', () => {
    const g = heatmapGrid([], '2026-10-01', '2026-10-01', 'en-US')
    expect(g.weeks).toHaveLength(1)
    expect(g.weeks[0].filter(Boolean)).toHaveLength(1)
  })
})

describe('nearestIndex', () => {
  it('finds the closest position', () => {
    expect(nearestIndex([0, 10, 20], 4)).toBe(0)
    expect(nearestIndex([0, 10, 20], 6)).toBe(1)
    expect(nearestIndex([0, 10, 20], 99)).toBe(2)
  })
  it('is -1 for nothing', () => {
    expect(nearestIndex([], 5)).toBe(-1)
  })
})

describe('spreadIndexes', () => {
  it('keeps everything when it fits', () => {
    expect(spreadIndexes(3, 5)).toEqual([0, 1, 2])
  })
  it('spreads evenly including both ends', () => {
    expect(spreadIndexes(9, 5)).toEqual([0, 2, 4, 6, 8])
    expect(spreadIndexes(30, 4)).toEqual([0, 10, 19, 29])
  })
  it('handles empty', () => {
    expect(spreadIndexes(0, 4)).toEqual([])
  })
})
