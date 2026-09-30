import { describe, expect, it } from 'vitest'
import {
  BUBBLE_MAX,
  BUBBLE_MIN,
  BUBBLE_SIZES,
  bubbleRect,
  clampBubble,
  clampSplit,
  containRect,
  cornerBubble,
  coverCrop,
  landscapeSize,
  lowerThird,
  nudgeBubble,
  pipRect,
  portraitSize,
  snapBubble,
  splitRects,
} from './geometry'

const HD = { width: 1280, height: 720 }

describe('canvas sizes', () => {
  it('landscape is 16:9 and portrait defaults to 720x1280', () => {
    expect(landscapeSize('auto')).toEqual(HD)
    expect(landscapeSize('1080p')).toEqual({ width: 1920, height: 1080 })
    expect(portraitSize('auto')).toEqual({ width: 720, height: 1280 })
    expect(portraitSize('1080p')).toEqual({ width: 1080, height: 1920 })
  })
})

describe('cover / contain', () => {
  it('crops a wide source to a narrow target from the middle', () => {
    expect(coverCrop(1920, 1080, 720, 1280)).toEqual({
      x: (1920 - 607.5) / 2,
      y: 0,
      w: 607.5,
      h: 1080,
    })
  })
  it('crops a tall source to a wide target from the middle', () => {
    const c = coverCrop(1080, 1920, 1280, 720)
    expect(c.w).toBe(1080)
    expect(c.h).toBeCloseTo(607.5)
    expect(c.y).toBeCloseTo((1920 - 607.5) / 2)
  })
  it('leaves an exact match alone and survives empty sources', () => {
    expect(coverCrop(1280, 720, 1280, 720)).toEqual({
      x: 0,
      y: 0,
      w: 1280,
      h: 720,
    })
    expect(coverCrop(0, 0, 100, 100)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
  it('letterboxes a screen inside the frame', () => {
    const r = containRect(1000, 1000, { x: 0, y: 0, w: 1280, h: 720 })
    expect(r).toEqual({ x: 280, y: 0, w: 720, h: 720 })
  })
})

describe('screen bubble', () => {
  it('starts bottom-right, inside the canvas', () => {
    const r = bubbleRect(HD, cornerBubble('br', BUBBLE_SIZES.M))
    expect(r.w).toBeCloseTo(720 * 0.26)
    expect(r.x + r.w).toBeLessThanOrEqual(1280)
    expect(r.y + r.h).toBeLessThanOrEqual(720)
    expect(r.x).toBeGreaterThan(640)
    expect(r.y).toBeGreaterThan(360)
  })
  it('places each of the four corners', () => {
    const at = (c: 'tl' | 'tr' | 'bl' | 'br') =>
      bubbleRect(HD, snapBubble(cornerBubble(c, 0.26), HD))
    expect(at('tl').x).toBeLessThan(640)
    expect(at('tl').y).toBeLessThan(360)
    expect(at('tr').x).toBeGreaterThan(640)
    expect(at('bl').y).toBeGreaterThan(360)
    expect(at('br').x).toBeGreaterThan(640)
  })
  it('never lets a drag leave the canvas', () => {
    const b = clampBubble({ cx: -3, cy: 9, size: 0.26 }, HD)
    const r = bubbleRect(HD, b)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y + r.h).toBeLessThanOrEqual(720 + 0.001)
  })
  it('clamps size to the allowed range', () => {
    expect(clampBubble({ cx: 0.5, cy: 0.5, size: 5 }, HD).size).toBe(BUBBLE_MAX)
    expect(clampBubble({ cx: 0.5, cy: 0.5, size: 0 }, HD).size).toBe(BUBBLE_MIN)
  })
  it('snaps a released drag to the nearest corner', () => {
    const snapped = snapBubble({ cx: 0.2, cy: 0.3, size: 0.26 }, HD)
    expect(snapped.cx).toBeLessThan(0.3)
    expect(snapped.cy).toBeLessThan(0.3)
    const br = snapBubble({ cx: 0.9, cy: 0.9, size: 0.26 }, HD)
    expect(br.cx).toBeGreaterThan(0.7)
    expect(br.cy).toBeGreaterThan(0.7)
  })
  it('nudges by pixels (drag and arrow keys)', () => {
    const b = { cx: 0.5, cy: 0.5, size: 0.26 }
    const n = nudgeBubble(b, HD, 128, -72)
    expect(n.cx).toBeCloseTo(0.6)
    expect(n.cy).toBeCloseTo(0.4)
  })
})

describe('split, pip and lower third', () => {
  it('side-by-side gives the text its share and keeps both panels inside the frame', () => {
    const { text, camera } = splitRects(HD, 0.5)
    expect(text.x + text.w).toBeLessThan(camera.x + 1)
    expect(camera.x + camera.w).toBeLessThanOrEqual(1280)
    const wide = splitRects(HD, 0.65)
    expect(wide.text.w).toBeGreaterThan(text.w)
  })
  it('clamps the split ratio', () => {
    expect(clampSplit(0.1)).toBe(0.3)
    expect(clampSplit(0.95)).toBe(0.7)
  })
  it('pip sits in the top-right corner with a margin', () => {
    const r = pipRect(HD)
    expect(r.x + r.w).toBeLessThan(1280)
    expect(r.y).toBeGreaterThan(0)
    expect(r.w).toBeCloseTo(1280 * 0.24, 0)
  })
  it('the portrait lower third is taller than the landscape one relative to the frame', () => {
    const p = lowerThird(portraitSize('auto'))
    const l = lowerThird(HD)
    expect(p.h / 1280).toBeCloseTo(0.3, 1)
    expect(l.h / 720).toBeCloseTo(0.34, 1)
    expect(p.y + p.h).toBeLessThan(1280)
  })
})
