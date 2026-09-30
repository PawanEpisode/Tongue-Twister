import { describe, expect, it } from 'vitest'
import { rmsFromBytes } from './audioMixer'

describe('rmsFromBytes', () => {
  it('is 0 for silence and for no data', () => {
    expect(rmsFromBytes(new Uint8Array(64).fill(128))).toBe(0)
    expect(rmsFromBytes([])).toBe(0)
  })
  it('is 1 for a full-scale square wave and ~0.7 for a full-scale sine', () => {
    expect(rmsFromBytes(Uint8Array.from([0, 255, 0, 255]))).toBeGreaterThan(
      0.99,
    )
    const sine = Uint8Array.from(
      { length: 256 },
      (_, i) => 128 + 127 * Math.sin((i / 256) * Math.PI * 8),
    )
    expect(rmsFromBytes(sine)).toBeCloseTo(0.707, 1)
  })
})
