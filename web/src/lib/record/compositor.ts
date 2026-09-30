/**
 * Draws a layout onto a hidden canvas at a fixed frame rate and exposes it as a video track.
 * The frame clock is injected, so tests drive it by hand.
 */
import { createFrameClock } from './frameClock'
import type { FrameClock } from './frameClock'
import type { FrameInputs, LayoutDef, LayoutState, Size } from './layouts/types'

export type CompositorOptions = {
  layout: LayoutDef
  size: Size
  fps: number
  /** Read each frame (mutable refs), so React never re-renders per frame. */
  frame: () => FrameInputs
  state: () => LayoutState
  /** The canvas the user sees while preparing/recording (read each frame, so it can mount late). */
  getPreview?: () => HTMLCanvasElement | null
  /**
   * The preview shows the camera mirrored, like a mirror, while the file may not be. When this
   * differs from the saved `state().mirror` the layout is drawn a second time for the preview.
   */
  previewMirror?: () => boolean
}
export type CompositorDeps = {
  canvas?: HTMLCanvasElement
  clock?: FrameClock
}

export type Compositor = {
  canvas: HTMLCanvasElement
  /** The composited video track (null when captureStream is unavailable). */
  videoTrack: MediaStreamTrack | null
  start: () => void
  /** Draw one frame now (used to paint the first frame before the clock ticks). */
  renderNow: () => void
  stop: () => void
  /** Stops the clock and the canvas track; safe to call twice. */
  dispose: () => void
}

export function createCompositor(
  opts: CompositorOptions,
  deps: CompositorDeps = {},
): Compositor {
  const canvas = deps.canvas ?? document.createElement('canvas')
  canvas.width = opts.size.width
  canvas.height = opts.size.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new DOMException('2D canvas unavailable', 'NotSupportedError')
  const clock = deps.clock ?? createFrameClock()
  const stream = canvas.captureStream(opts.fps)
  const videoTrack = stream.getVideoTracks()[0] ?? null
  let disposed = false

  const renderNow = () => {
    if (disposed) return
    const frame = opts.frame()
    const state = opts.state()
    opts.layout.draw(ctx, opts.size, frame, state)
    const preview = opts.getPreview?.()
    if (!preview) return
    if (preview.width !== opts.size.width) preview.width = opts.size.width
    if (preview.height !== opts.size.height) preview.height = opts.size.height
    const pctx = preview.getContext('2d')
    if (!pctx) return
    const wantMirror = opts.previewMirror?.() ?? state.mirror
    if (wantMirror === state.mirror) pctx.drawImage(canvas, 0, 0)
    else
      opts.layout.draw(pctx, opts.size, frame, { ...state, mirror: wantMirror })
  }

  return {
    canvas,
    videoTrack,
    renderNow,
    start() {
      if (disposed) return
      renderNow()
      clock.start(opts.fps, renderNow)
    },
    stop() {
      clock.stop()
    },
    dispose() {
      if (disposed) return
      disposed = true
      clock.stop()
      stream.getTracks().forEach((t) => t.stop())
    },
  }
}
