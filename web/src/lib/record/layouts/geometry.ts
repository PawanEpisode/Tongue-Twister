/** Layout maths, all pure: crops, bubble corners and drag clamping, split rects, canvas sizes. */
import { pixels } from '../quality'
import type { Resolution } from '../quality'
import type { BubbleState, Rect, Size } from './types'

export const landscapeSize = (res: Resolution): Size => {
  const p = pixels(res)
  return { width: p.long, height: p.short }
}
/** Portrait defaults to 720×1280 (PRD 04 L6) and 1080×1920 at 1080p. */
export const portraitSize = (res: Resolution): Size => {
  const p = pixels(res)
  return { width: p.short, height: p.long }
}

/** Source rectangle to draw so the source fills the destination without stretching (CSS `object-fit: cover`). */
export function coverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Rect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0)
    return { x: 0, y: 0, w: srcW, h: srcH }
  const srcRatio = srcW / srcH
  const dstRatio = dstW / dstH
  if (srcRatio > dstRatio) {
    const w = srcH * dstRatio
    return { x: (srcW - w) / 2, y: 0, w, h: srcH }
  }
  const h = srcW / dstRatio
  return { x: 0, y: (srcH - h) / 2, w: srcW, h }
}

/** Where the source lands inside the destination so all of it shows (CSS `object-fit: contain`). */
export function containRect(srcW: number, srcH: number, dst: Rect): Rect {
  if (srcW <= 0 || srcH <= 0) return dst
  const scale = Math.min(dst.w / srcW, dst.h / srcH)
  const w = srcW * scale
  const h = srcH * scale
  return { x: dst.x + (dst.w - w) / 2, y: dst.y + (dst.h - h) / 2, w, h }
}

export const BUBBLE_SIZES = { S: 0.18, M: 0.26, L: 0.36 } as const
export type BubbleSizeKey = keyof typeof BUBBLE_SIZES
export const BUBBLE_MIN = 0.12
export const BUBBLE_MAX = 0.5
export type Corner = 'tl' | 'tr' | 'bl' | 'br'
const EDGE = 0.03 // gap between bubble and canvas edge, as a fraction of the short side

export const DEFAULT_BUBBLE: BubbleState = cornerBubble('br', BUBBLE_SIZES.M)

/** Bubble diameter in pixels. */
export const bubbleDiameter = (canvas: Size, b: BubbleState): number =>
  Math.min(canvas.width, canvas.height) * b.size

/** A bubble sitting in a corner. Centre fractions are relative to each axis, so the gap stays constant in pixels. */
export function cornerBubble(corner: Corner, size: number): BubbleState {
  const half = size / 2 + EDGE
  // Fractions of the short side are converted later against the real canvas; for a corner we use
  // per-axis fractions of a 16:9 frame as the reference, then `clampBubble` fixes any other shape.
  const fx = half * (9 / 16)
  const fy = half
  const left = corner === 'tl' || corner === 'bl'
  const top = corner === 'tl' || corner === 'tr'
  return { cx: left ? fx : 1 - fx, cy: top ? fy : 1 - fy, size }
}

/** Keep the whole bubble inside the canvas. */
export function clampBubble(b: BubbleState, canvas: Size): BubbleState {
  const size = Math.min(BUBBLE_MAX, Math.max(BUBBLE_MIN, b.size))
  const d = Math.min(canvas.width, canvas.height) * size
  const mx = d / 2 / canvas.width
  const my = d / 2 / canvas.height
  return {
    size,
    cx: Math.min(1 - mx, Math.max(mx, b.cx)),
    cy: Math.min(1 - my, Math.max(my, b.cy)),
  }
}

/** The bubble as a square in canvas pixels (drawn as a circle). */
export function bubbleRect(canvas: Size, b: BubbleState): Rect {
  const c = clampBubble(b, canvas)
  const d = bubbleDiameter(canvas, c)
  return {
    x: c.cx * canvas.width - d / 2,
    y: c.cy * canvas.height - d / 2,
    w: d,
    h: d,
  }
}

/** Snap a dragged bubble to the nearest corner, keeping its size. */
export function snapBubble(b: BubbleState, canvas: Size): BubbleState {
  const corner: Corner = `${b.cy < 0.5 ? 't' : 'b'}${b.cx < 0.5 ? 'l' : 'r'}`
  const d = Math.min(canvas.width, canvas.height) * b.size
  const gap = EDGE * Math.min(canvas.width, canvas.height)
  const mx = (d / 2 + gap) / canvas.width
  const my = (d / 2 + gap) / canvas.height
  return clampBubble(
    {
      size: b.size,
      cx: corner.endsWith('l') ? mx : 1 - mx,
      cy: corner.startsWith('t') ? my : 1 - my,
    },
    canvas,
  )
}

/** Move a bubble by a pixel delta on the canvas (drag and arrow keys share this). */
export function nudgeBubble(
  b: BubbleState,
  canvas: Size,
  dx: number,
  dy: number,
): BubbleState {
  return clampBubble(
    { ...b, cx: b.cx + dx / canvas.width, cy: b.cy + dy / canvas.height },
    canvas,
  )
}

export const clampSplit = (ratio: number): number =>
  Math.min(0.7, Math.max(0.3, ratio))

/** Side-by-side: text on the left `ratio`, the camera in a padded, rounded panel on the right. */
export function splitRects(
  canvas: Size,
  ratio: number,
): { text: Rect; camera: Rect } {
  const r = clampSplit(ratio)
  const pad = Math.round(canvas.height * 0.04)
  const textW = Math.round(canvas.width * r)
  return {
    text: { x: pad, y: pad, w: textW - pad * 1.5, h: canvas.height - pad * 2 },
    camera: {
      x: textW + pad / 2,
      y: pad,
      w: canvas.width - textW - pad * 1.5,
      h: canvas.height - pad * 2,
    },
  }
}

/** Small camera picture-in-picture in the top-right corner. */
export function pipRect(canvas: Size): Rect {
  const w = Math.round(canvas.width * 0.24)
  const h = Math.round(w * (canvas.height >= canvas.width ? 4 / 3 : 9 / 16))
  const pad = Math.round(Math.min(canvas.width, canvas.height) * 0.04)
  return { x: canvas.width - w - pad, y: pad, w, h }
}

/** The lower-third text card over full-frame video. */
export function lowerThird(canvas: Size): Rect {
  const pad = Math.round(canvas.width * 0.04)
  const h = Math.round(
    canvas.height * (canvas.height > canvas.width ? 0.3 : 0.34),
  )
  return { x: pad, y: canvas.height - h - pad, w: canvas.width - pad * 2, h }
}
