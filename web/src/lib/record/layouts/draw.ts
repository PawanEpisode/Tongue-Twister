/** Canvas drawing primitives shared by the layouts. Sizes are read from the source, never assumed. */
import { containRect, coverCrop } from './geometry'
import { roundRect } from './text'
import type { FrameSource, Rect } from './types'

export function sourceSize(src: FrameSource): { w: number; h: number } {
  const num = (v: unknown) => (typeof v === 'number' ? v : 0)
  return {
    w: num((src as { videoWidth?: number }).videoWidth) || num(src.width),
    h: num((src as { videoHeight?: number }).videoHeight) || num(src.height),
  }
}

/** Draw `src` filling `dst` (cropping the overflow). `mirror` flips it left-right. */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  src: FrameSource,
  dst: Rect,
  mirror = false,
): void {
  const { w, h } = sourceSize(src)
  if (!w || !h) return // no frame yet
  const c = coverCrop(w, h, dst.w, dst.h)
  ctx.save()
  if (mirror) {
    ctx.translate(dst.x + dst.w, dst.y)
    ctx.scale(-1, 1)
    ctx.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, dst.w, dst.h)
  } else ctx.drawImage(src, c.x, c.y, c.w, c.h, dst.x, dst.y, dst.w, dst.h)
  ctx.restore()
}

/** Draw `src` whole inside `dst` (letterboxed on black). */
export function drawContain(
  ctx: CanvasRenderingContext2D,
  src: FrameSource,
  dst: Rect,
): void {
  const { w, h } = sourceSize(src)
  if (!w || !h) return
  const r = containRect(w, h, dst)
  ctx.drawImage(src, r.x, r.y, r.w, r.h)
}

export function drawRoundedCover(
  ctx: CanvasRenderingContext2D,
  src: FrameSource,
  dst: Rect,
  radius: number,
  mirror: boolean,
): void {
  ctx.save()
  roundRect(ctx, dst, radius)
  ctx.clip()
  drawCover(ctx, src, dst, mirror)
  ctx.restore()
}

export function drawCircleCover(
  ctx: CanvasRenderingContext2D,
  src: FrameSource,
  dst: Rect,
  mirror: boolean,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.arc(dst.x + dst.w / 2, dst.y + dst.h / 2, dst.w / 2, 0, Math.PI * 2)
  ctx.clip()
  drawCover(ctx, src, dst, mirror)
  ctx.restore()
  ctx.save()
  ctx.lineWidth = Math.max(3, dst.w * 0.02)
  ctx.strokeStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(dst.x + dst.w / 2, dst.y + dst.h / 2, dst.w / 2, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

export function fillBackdrop(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
): void {
  const g = ctx.createLinearGradient(0, 0, size.width, size.height)
  g.addColorStop(0, '#15132a')
  g.addColorStop(1, '#2b1d5c')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size.width, size.height)
}

/** Audio-only fallback: a dark card with level bars, so a take without a camera is still a valid video. */
export function drawAudioCard(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
  level: number,
  elapsedMs: number,
): void {
  fillBackdrop(ctx, size)
  const bars = 21
  const gap = size.width * 0.012
  const bw = (size.width * 0.5 - gap * (bars - 1)) / bars
  const x0 = size.width * 0.25
  const cy = size.height * 0.5
  ctx.fillStyle = '#8b6bff'
  for (let i = 0; i < bars; i++) {
    const wave = 0.5 + 0.5 * Math.sin(elapsedMs / 180 + i * 0.7)
    const h = size.height * (0.03 + 0.3 * Math.min(1, level * 2.2) * wave)
    roundRect(ctx, { x: x0 + i * (bw + gap), y: cy - h / 2, w: bw, h }, bw / 2)
    ctx.fill()
  }
}
