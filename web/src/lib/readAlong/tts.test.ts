import { describe, expect, it } from 'vitest'
import { ttsRate } from './useListenFirst'

describe('ttsRate', () => {
  it('maps WPM to a Web Speech rate (≈170 WPM = 1.0) and clamps', () => {
    expect(ttsRate(170)).toBeCloseTo(1)
    expect(ttsRate(40)).toBe(0.5)
    expect(ttsRate(300)).toBeCloseTo(300 / 170)
    expect(ttsRate(1000)).toBe(2)
    expect(ttsRate(170, 1.5)).toBeCloseTo(1.5)
  })
})
