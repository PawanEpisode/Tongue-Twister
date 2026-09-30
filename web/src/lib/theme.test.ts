import { describe, expect, it } from 'vitest'
import {
  msUntilNextThemeBoundary,
  resolveTheme,
  themeForLocalTime,
} from './theme'

function at(hour: number, minute = 0) {
  return new Date(2026, 5, 15, hour, minute, 0, 0)
}

describe('themeForLocalTime', () => {
  it('is dark before 7:00 and from 19:00 onward', () => {
    expect(themeForLocalTime(at(0))).toBe('dark')
    expect(themeForLocalTime(at(6, 59))).toBe('dark')
    expect(themeForLocalTime(at(19))).toBe('dark')
    expect(themeForLocalTime(at(23, 30))).toBe('dark')
  })

  it('is light from 7:00 until 19:00', () => {
    expect(themeForLocalTime(at(7))).toBe('light')
    expect(themeForLocalTime(at(12))).toBe('light')
    expect(themeForLocalTime(at(18, 59))).toBe('light')
  })
})

describe('resolveTheme', () => {
  it('uses the local clock only for system', () => {
    expect(resolveTheme('system', at(8))).toBe('light')
    expect(resolveTheme('system', at(21))).toBe('dark')
    expect(resolveTheme('reading', at(8))).toBe('reading')
    expect(resolveTheme('dark', at(8))).toBe('dark')
    expect(resolveTheme('light', at(21))).toBe('light')
  })
})

describe('msUntilNextThemeBoundary', () => {
  it('points at the next day or night boundary', () => {
    expect(msUntilNextThemeBoundary(at(6, 0))).toBe(60 * 60 * 1000)
    expect(msUntilNextThemeBoundary(at(7, 0))).toBe(12 * 60 * 60 * 1000)
    expect(msUntilNextThemeBoundary(at(19, 0))).toBe(12 * 60 * 60 * 1000)
  })
})
