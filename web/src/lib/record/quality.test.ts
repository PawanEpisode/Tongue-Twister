import { describe, expect, it } from 'vitest'
import {
  HEADROOM_FACTOR,
  estimateBytes,
  formatBytes,
  formatClock,
  pixels,
  storageHeadroom,
  videoBitrate,
} from './quality'

describe('quality', () => {
  it('720p30 is ~2 Mbps and 1080p30 stays under the 6 Mbps cap', () => {
    expect(videoBitrate(1280, 720)).toBe(2_000_000)
    expect(videoBitrate(1920, 1080)).toBeGreaterThan(4_000_000)
    expect(videoBitrate(1920, 1080)).toBeLessThanOrEqual(6_000_000)
    expect(videoBitrate(720, 1280)).toBe(2_000_000) // portrait: same pixel count
  })
  it('auto means 720p', () => {
    expect(pixels('auto')).toEqual({ long: 1280, short: 720 })
    expect(pixels('1080p')).toEqual({ long: 1920, short: 1080 })
  })
  it('estimates roughly 15 MB per minute at the default', () => {
    const mb = estimateBytes(60_000, 2_000_000) / (1024 * 1024)
    expect(mb).toBeGreaterThan(14)
    expect(mb).toBeLessThan(17)
  })
  it('blocks a start when free space is under 3x the estimate', () => {
    const need = 10_000_000
    expect(storageHeadroom({ quota: 100e6, usage: 90e6 }, need)).toEqual({
      ok: false,
      needBytes: need * HEADROOM_FACTOR,
      freeBytes: 10e6,
    })
    expect(storageHeadroom({ quota: 100e6, usage: 10e6 }, need).ok).toBe(true)
    expect(storageHeadroom(undefined, need).ok).toBe(true)
    expect(storageHeadroom({ usage: 5 }, need).ok).toBe(true)
  })
  it('formats sizes and clocks', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB')
    expect(formatClock(83_000)).toBe('1:23')
    expect(formatClock(-5)).toBe('0:00')
  })
})
