import { describe, expect, it } from 'vitest'
import { faceHint, lightingHint, meanLuma } from './hints'

const flat = (v: number, px = 4) =>
  Uint8ClampedArray.from({ length: px * 4 }, (_, i) => (i % 4 === 3 ? 255 : v))

describe('lighting', () => {
  it('measures brightness', () => {
    expect(meanLuma(flat(0))).toBe(0)
    expect(meanLuma(flat(255))).toBeCloseTo(255)
    expect(meanLuma([])).toBe(0)
  })
  it('flags dark and washed-out pictures but not normal ones', () => {
    expect(lightingHint(meanLuma(flat(20)))).toBe('too_dark')
    expect(lightingHint(meanLuma(flat(240)))).toBe('too_bright')
    expect(lightingHint(meanLuma(flat(120)))).toBe('ok')
  })
})

describe('face in frame', () => {
  it('only speaks up after several consecutive misses', () => {
    expect(faceHint([false, false])).toBe(false)
    expect(faceHint([true, false, false])).toBe(false)
    expect(faceHint([false, false, false])).toBe(true)
    expect(faceHint([false, false, false, true])).toBe(false)
  })
})
