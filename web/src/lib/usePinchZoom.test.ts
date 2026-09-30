import { describe, expect, it } from 'vitest'
import { safePath } from './returnTo'
import { pinchScale } from './usePinchZoom'

describe('pinchScale', () => {
  const range = [0.8, 2] as const
  it('scales with finger spread, snapped to 0.05', () => {
    expect(pinchScale(1, 100, 150, range)).toBe(1.5)
    expect(pinchScale(1, 100, 103, range)).toBe(1.05)
  })
  it('clamps to the allowed range', () => {
    expect(pinchScale(1, 100, 1000, range)).toBe(2)
    expect(pinchScale(1, 100, 1, range)).toBe(0.8)
  })
})

describe('safePath', () => {
  it('accepts same-origin paths only', () => {
    expect(safePath('/twisters/abc?mode=read')).toBe('/twisters/abc?mode=read')
    expect(safePath('//evil.com')).toBeUndefined()
    expect(safePath('https://evil.com')).toBeUndefined()
    expect(safePath(undefined)).toBeUndefined()
  })
})
