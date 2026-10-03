import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, PREFERENCE_RANGES } from '#/lib/preferences'
import { SETTING_PRESETS, presetPatch, undoPatch } from './presets'

const get = (id: string) => SETTING_PRESETS.find((p) => p.id === id)!

describe('presets', () => {
  it('only use known preferences with in-range values', () => {
    for (const p of SETTING_PRESETS)
      for (const [key, value] of Object.entries(p.values)) {
        expect(key in DEFAULT_PREFERENCES).toBe(true)
        const range = PREFERENCE_RANGES[key as keyof typeof PREFERENCE_RANGES]
        if (range && typeof value === 'number') {
          expect(value).toBeGreaterThanOrEqual(range[0])
          expect(value).toBeLessThanOrEqual(range[1])
        }
      }
  })
  it('never touch the theme or the daily goal', () => {
    for (const p of SETTING_PRESETS) {
      expect('theme' in p.values).toBe(false)
      expect('daily_goal_attempts' in p.values).toBe(false)
    }
  })
  it('apply only what differs, so a second apply is a no-op', () => {
    const preset = get('easy-reading')
    const patch = presetPatch(preset, DEFAULT_PREFERENCES)
    expect(Object.keys(patch).length).toBeGreaterThan(0)
    expect(presetPatch(preset, { ...DEFAULT_PREFERENCES, ...patch })).toEqual(
      {},
    )
  })
  it('can be undone exactly', () => {
    const patch = presetPatch(get('gentle-start'), DEFAULT_PREFERENCES)
    const applied = { ...DEFAULT_PREFERENCES, ...patch }
    expect({ ...applied, ...undoPatch(patch, DEFAULT_PREFERENCES) }).toEqual(
      DEFAULT_PREFERENCES,
    )
  })
  it('reset returns a customised setup to the defaults', () => {
    const custom = {
      ...DEFAULT_PREFERENCES,
      font_scale: 1.8,
      mirror_text: true,
    }
    const patch = presetPatch(get('defaults'), custom)
    expect({ ...custom, ...patch }).toEqual(DEFAULT_PREFERENCES)
  })
})
