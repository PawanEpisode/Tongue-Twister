import { describe, expect, it } from 'vitest'
import { asCtx, FakeCtx } from '../testing/fakes'
import {
  DEFAULT_LAYOUT,
  DEFAULT_LAYOUT_STATE,
  LAYOUT_LIST,
  getLayout,
  isLayoutId,
  usesCanvas,
} from './index'
import type { FrameInputs, FrameSource } from './types'

const source = (w: number, h: number) =>
  ({ videoWidth: w, videoHeight: h }) as unknown as FrameSource
const frame = (over: Partial<FrameInputs> = {}): FrameInputs => ({
  camera: source(1280, 720),
  screen: source(1920, 1080),
  text: {
    words: ['peter', 'piper', 'picked'],
    current: 1,
    hits: [true, false, false],
  },
  level: 0.3,
  elapsedMs: 1200,
  ...over,
})

describe('layout registry', () => {
  it('has seven layouts with unique ids, in L1…L7 order', () => {
    expect(LAYOUT_LIST.map((l) => l.id)).toEqual([
      'camera',
      'camera_text',
      'side_by_side',
      'screen_bubble',
      'pip',
      'portrait',
      'region',
    ])
    expect(new Set(LAYOUT_LIST.map((l) => l.id)).size).toBe(7)
  })
  it('looks layouts up and validates ids', () => {
    expect(getLayout(DEFAULT_LAYOUT).id).toBe('camera_text')
    expect(isLayoutId('pip')).toBe(true)
    expect(isLayoutId('nope')).toBe(false)
    expect(isLayoutId(3)).toBe(false)
  })
  it('only camera-only (L1) and region (L7) skip the canvas; L1 falls back to it without a camera', () => {
    const raw = LAYOUT_LIST.filter((l) => l.raw).map((l) => l.id)
    expect(raw).toEqual(['camera', 'region'])
    expect(usesCanvas(getLayout('camera'), true)).toBe(false)
    expect(usesCanvas(getLayout('camera'), false)).toBe(true) // audio-only take
    expect(usesCanvas(getLayout('region'), false)).toBe(false)
    expect(usesCanvas(getLayout('camera_text'), true)).toBe(true)
  })
  it('declares what each layout needs', () => {
    expect(getLayout('screen_bubble').needs).toMatchObject({
      camera: true,
      screen: true,
    })
    expect(getLayout('region').needs).toMatchObject({
      screen: true,
      region: true,
    })
    expect(getLayout('camera').needs).toMatchObject({
      camera: true,
      screen: false,
    })
  })
  it('every layout has picker shapes inside its board', () => {
    for (const l of LAYOUT_LIST) {
      expect(l.thumb.length).toBeGreaterThan(0)
      const [bw, bh] = l.portrait ? [90, 160] : [160, 90]
      for (const t of l.thumb) {
        expect(t.x + t.w).toBeLessThanOrEqual(bw)
        expect(t.y + t.h).toBeLessThanOrEqual(bh)
      }
    }
  })
  it('sizes: landscape 16:9, portrait 9:16 (default 720x1280)', () => {
    for (const l of LAYOUT_LIST) {
      const s = l.size('auto')
      if (l.id === 'portrait') expect(s).toEqual({ width: 720, height: 1280 })
      else expect(s.width / s.height).toBeCloseTo(16 / 9)
    }
    expect(getLayout('portrait').size('1080p')).toEqual({
      width: 1080,
      height: 1920,
    })
  })
  it.each(LAYOUT_LIST.map((l) => l.id))(
    '%s draws every frame kind without throwing',
    (id) => {
      const layout = getLayout(id)
      const ctx = new FakeCtx()
      const size = layout.size('auto')
      layout.draw(asCtx(ctx), size, frame(), DEFAULT_LAYOUT_STATE)
      expect(ctx.calls.length).toBeGreaterThan(0)
      // no camera yet (first frames), no screen, and the audio-only take
      layout.draw(
        asCtx(new FakeCtx()),
        size,
        frame({ camera: null, screen: null }),
        DEFAULT_LAYOUT_STATE,
      )
      layout.draw(
        asCtx(new FakeCtx()),
        size,
        frame({ text: { words: [], current: -1, hits: [] } }),
        {
          ...DEFAULT_LAYOUT_STATE,
          mirror: true,
        },
      )
    },
  )
  it('text layouts actually write the words; camera-only does not', () => {
    for (const id of [
      'camera_text',
      'side_by_side',
      'pip',
      'portrait',
    ] as const) {
      const ctx = new FakeCtx()
      getLayout(id).draw(
        asCtx(ctx),
        getLayout(id).size('auto'),
        frame(),
        DEFAULT_LAYOUT_STATE,
      )
      expect(ctx.calls.filter((c) => c === 'fillText')).toHaveLength(3)
    }
    const ctx = new FakeCtx()
    getLayout('camera').draw(
      asCtx(ctx),
      getLayout('camera').size('auto'),
      frame(),
      DEFAULT_LAYOUT_STATE,
    )
    expect(ctx.calls).not.toContain('fillText')
  })
  it('screen + bubble draws the screen and the bubble, and the camera alone once sharing stops', () => {
    const l = getLayout('screen_bubble')
    const both = new FakeCtx()
    l.draw(asCtx(both), l.size('auto'), frame(), DEFAULT_LAYOUT_STATE)
    expect(both.calls.filter((c) => c === 'drawImage')).toHaveLength(2)
    expect(both.calls).toContain('arc')
    const camOnly = new FakeCtx()
    l.draw(
      asCtx(camOnly),
      l.size('auto'),
      frame({ screen: null }),
      DEFAULT_LAYOUT_STATE,
    )
    expect(camOnly.calls.filter((c) => c === 'drawImage')).toHaveLength(1)
    expect(camOnly.calls).not.toContain('arc')
  })
  it('mirroring flips the camera (translate + negative scale)', () => {
    const l = getLayout('camera_text')
    const plain = new FakeCtx()
    l.draw(asCtx(plain), l.size('auto'), frame(), DEFAULT_LAYOUT_STATE)
    const mirrored = new FakeCtx()
    l.draw(asCtx(mirrored), l.size('auto'), frame(), {
      ...DEFAULT_LAYOUT_STATE,
      mirror: true,
    })
    expect(plain.calls).not.toContain('scale')
    expect(mirrored.calls).toContain('scale')
  })
})
