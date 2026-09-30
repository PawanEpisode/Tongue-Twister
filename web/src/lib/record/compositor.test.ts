import { describe, expect, it, vi } from 'vitest'
import { createCompositor } from './compositor'
import { DEFAULT_LAYOUT_STATE, getLayout } from './layouts'
import { ManualClock, fakeCanvas } from './testing/fakes'

const frame = () => ({
  camera: null,
  screen: null,
  text: { words: ['a'], current: 0, hits: [] },
  level: 0,
  elapsedMs: 0,
})

describe('compositor', () => {
  it('sizes the canvas and draws on every clock tick, independent of animation frames', () => {
    const { canvas } = fakeCanvas()
    const clock = new ManualClock()
    const layout = getLayout('camera_text')
    const draw = vi.spyOn(layout, 'draw')
    const c = createCompositor(
      {
        layout,
        size: { width: 1280, height: 720 },
        fps: 30,
        frame,
        state: () => DEFAULT_LAYOUT_STATE,
      },
      { canvas, clock },
    )
    expect(canvas.width).toBe(1280)
    c.start()
    expect(draw).toHaveBeenCalledTimes(1) // first frame is painted straight away
    clock.fire(3)
    expect(draw).toHaveBeenCalledTimes(4)
    draw.mockRestore()
  })
  it('draws a second, mirrored copy for the preview only when the preview mirror differs from the file', () => {
    const { canvas } = fakeCanvas()
    const { canvas: preview } = fakeCanvas()
    const clock = new ManualClock()
    const layout = getLayout('camera_text')
    const draw = vi.spyOn(layout, 'draw')
    const c = createCompositor(
      {
        layout,
        size: { width: 640, height: 360 },
        fps: 30,
        frame,
        state: () => ({ ...DEFAULT_LAYOUT_STATE, mirror: false }),
        getPreview: () => preview,
        previewMirror: () => true,
      },
      { canvas, clock },
    )
    c.renderNow()
    expect(draw).toHaveBeenCalledTimes(2)
    expect(draw.mock.calls[1][3].mirror).toBe(true) // preview copy
    expect(draw.mock.calls[0][3].mirror).toBe(false) // the recorded canvas stays un-mirrored
    draw.mockRestore()
  })
  it('dispose stops the clock and the canvas track, and is safe twice', () => {
    const { canvas, videoTrack } = fakeCanvas()
    const clock = new ManualClock()
    const c = createCompositor(
      {
        layout: getLayout('pip'),
        size: { width: 640, height: 360 },
        fps: 30,
        frame,
        state: () => DEFAULT_LAYOUT_STATE,
      },
      { canvas, clock },
    )
    c.start()
    expect(clock.running).toBe(true)
    c.dispose()
    c.dispose()
    expect(clock.running).toBe(false)
    expect(videoTrack.stopped).toBe(true)
    c.renderNow() // no-op after dispose, must not throw
  })
})
