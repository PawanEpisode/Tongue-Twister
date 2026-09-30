import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, layoutStateOf, sanitizeSettings } from './settings'

describe('sanitizeSettings', () => {
  it('turns junk into defaults without throwing', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(
      sanitizeSettings({
        layout: 'bogus',
        resolution: '4k',
        countdownS: 7,
        wpm: 'fast',
      }),
    ).toMatchObject({
      layout: DEFAULT_SETTINGS.layout,
      resolution: 'auto',
      countdownS: 3,
      wpm: null,
    })
  })
  it('keeps valid choices and clamps numbers', () => {
    const s = sanitizeSettings({
      layout: 'side_by_side',
      resolution: '1080p',
      countdownS: 0,
      wpm: 999,
      textScale: 9,
      splitRatio: 0.99,
      highlight: 'both',
      mirrorSaved: true,
      bubble: { cx: -4, cy: 4, size: 3 },
    })
    expect(s.layout).toBe('side_by_side')
    expect(s.resolution).toBe('1080p')
    expect(s.countdownS).toBe(0)
    expect(s.wpm).toBe(300)
    expect(s.textScale).toBe(2)
    expect(s.splitRatio).toBe(0.7)
    expect(s.highlight).toBe('both')
    expect(s.mirrorSaved).toBe(true)
    expect(s.bubble.size).toBeLessThanOrEqual(0.5)
    expect(s.bubble.cx).toBeGreaterThan(0)
    expect(s.bubble.cy).toBeLessThan(1)
  })
  it('saved video is not mirrored and the preview is, by default', () => {
    expect(DEFAULT_SETTINGS.mirrorPreview).toBe(true)
    expect(DEFAULT_SETTINGS.mirrorSaved).toBe(false)
    expect(layoutStateOf(DEFAULT_SETTINGS).mirror).toBe(false)
  })
  it('device ids are strings and capped', () => {
    expect(sanitizeSettings({ cameraId: 5 }).cameraId).toBe('')
    expect(
      sanitizeSettings({ cameraId: 'x'.repeat(500) }).cameraId,
    ).toHaveLength(200)
  })
})
