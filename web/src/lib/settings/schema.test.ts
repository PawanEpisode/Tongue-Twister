import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, PREFERENCE_RANGES } from '#/lib/preferences'
import { formatRangeValue } from './format'
import { SETTING_GROUPS } from './schema'

const fields = SETTING_GROUPS.flatMap((g) => g.fields)

describe('settings schema', () => {
  it('has unique ids and non-empty groups', () => {
    const ids = SETTING_GROUPS.map((g) => g.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const g of SETTING_GROUPS) expect(g.fields.length).toBeGreaterThan(0)
  })
  it('never lists a preference twice', () => {
    const keys = fields.flatMap((f) => ('key' in f ? [f.key] : []))
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('only references known preferences with in-range defaults', () => {
    for (const f of fields) {
      if (!('key' in f)) continue
      expect(f.key in DEFAULT_PREFERENCES).toBe(true)
      if (f.type === 'range') {
        const [lo, hi] = PREFERENCE_RANGES[f.key]
        const v = DEFAULT_PREFERENCES[f.key]
        expect(v).toBeGreaterThanOrEqual(lo)
        expect(v).toBeLessThanOrEqual(hi)
      }
      if (f.type === 'select')
        expect(f.options.map((o) => o.value)).toContain(
          DEFAULT_PREFERENCES[f.key],
        )
    }
  })
})

describe('formatRangeValue', () => {
  it('reads naturally', () => {
    expect(formatRangeValue({ unit: '×' }, 1.2)).toBe('1.2×')
    expect(formatRangeValue({ unit: 's', zeroLabel: 'Off' }, 0)).toBe('Off')
    expect(formatRangeValue({ unit: 's', zeroLabel: 'Off' }, 3)).toBe('3s')
    expect(formatRangeValue({ unit: 'wpm' }, 120)).toBe('120 wpm')
    expect(formatRangeValue({}, 0.5)).toBe('50%')
  })
})
