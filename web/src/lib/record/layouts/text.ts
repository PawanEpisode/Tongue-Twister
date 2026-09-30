/** The twister text on a canvas: word wrapping, which lines to show, and drawing with the live highlight. */
import type { Rect, TextLayer } from './types'

export type Line = { from: number; to: number } // word indexes, [from, to)

/** Greedy word wrap. `measure` is `ctx.measureText(s).width` (injected so this is testable). */
export function wrapWords(
  words: readonly string[],
  measure: (s: string) => number,
  maxWidth: number,
  spaceWidth: number,
): Line[] {
  const lines: Line[] = []
  let from = 0
  let width = 0
  words.forEach((w, i) => {
    const ww = measure(w)
    const add = i === from ? ww : spaceWidth + ww
    if (i > from && width + add > maxWidth) {
      lines.push({ from, to: i })
      from = i
      width = ww
    } else width += add
  })
  if (words.length > from) lines.push({ from, to: words.length })
  return lines
}

/** A window of at most `maxLines` lines that keeps the current line in view (the 2nd line when scrolling). */
export function visibleLines(
  lines: readonly Line[],
  current: number,
  maxLines: number,
): Line[] {
  if (lines.length <= maxLines) return [...lines]
  const at = Math.max(
    0,
    lines.findIndex((l) => current >= l.from && current < l.to),
  )
  const start = Math.min(Math.max(0, at - 1), lines.length - maxLines)
  return lines.slice(start, start + maxLines)
}

type Style = {
  /** Base font size in px before the scale. */
  fontPx: number
  scale: number
  align?: 'left' | 'center'
  card?: boolean
}

const FONT = '700 {px}px "Bricolage Grotesque", Inter, system-ui, sans-serif'

/** Draw the words inside `box`; returns nothing. Colours are fixed (the video is theme independent). */
export function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  box: Rect,
  text: TextLayer,
  style: Style,
): void {
  if (!text.words.length) return
  ctx.save()
  const pad = Math.round(box.h * 0.08)
  if (style.card) {
    ctx.fillStyle = 'rgba(11, 10, 22, 0.66)'
    roundRect(ctx, box, Math.round(box.h * 0.12))
    ctx.fill()
  }
  const inner: Rect = {
    x: box.x + pad,
    y: box.y + pad,
    w: box.w - pad * 2,
    h: box.h - pad * 2,
  }
  // Shrink until the whole twister fits or a readable minimum is hit; then scroll.
  let px = Math.max(14, Math.round(style.fontPx * style.scale))
  let lines: Line[] = []
  let maxLines = 1
  for (;;) {
    ctx.font = FONT.replace('{px}', String(px))
    const space = ctx.measureText(' ').width
    lines = wrapWords(
      text.words,
      (s) => ctx.measureText(s).width,
      inner.w,
      space,
    )
    maxLines = Math.max(1, Math.floor(inner.h / (px * 1.3)))
    if (lines.length <= maxLines || px <= 22) break
    px = Math.max(22, Math.round(px * 0.9))
  }
  const shown = visibleLines(lines, text.current, maxLines)
  const lineH = px * 1.3
  const blockH = shown.length * lineH
  let y = inner.y + (inner.h - blockH) / 2 + lineH / 2
  const space = ctx.measureText(' ').width
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  for (const line of shown) {
    const widths: number[] = []
    for (let i = line.from; i < line.to; i++)
      widths.push(ctx.measureText(text.words[i]).width)
    const total =
      widths.reduce((a, b) => a + b, 0) + space * (widths.length - 1)
    let x = style.align === 'left' ? inner.x : inner.x + (inner.w - total) / 2
    for (let i = line.from; i < line.to; i++) {
      const w = widths[i - line.from]
      if (i === text.current) {
        ctx.fillStyle = 'rgba(109, 77, 255, 0.85)'
        roundRect(
          ctx,
          { x: x - px * 0.15, y: y - px * 0.62, w: w + px * 0.3, h: px * 1.24 },
          px * 0.22,
        )
        ctx.fill()
      }
      ctx.fillStyle = text.hits[i] ? '#a3f75b' : '#ffffff'
      ctx.fillText(text.words[i], x, y)
      x += w + space
    }
    y += lineH
  }
  ctx.restore()
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  radius: number,
): void {
  const rad = Math.min(radius, r.w / 2, r.h / 2)
  ctx.beginPath()
  ctx.moveTo(r.x + rad, r.y)
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad)
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad)
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y, rad)
  ctx.arcTo(r.x, r.y, r.x + r.w, r.y, rad)
  ctx.closePath()
}
