import { drawRoundedCover, fillBackdrop } from './draw'
import { landscapeSize, pipRect } from './geometry'
import { drawTextLayer } from './text'
import type { LayoutDef } from './types'

/** L5 — big text stage with the camera as a small picture-in-picture. Suits long passages. */
export const pipLayout: LayoutDef = {
  id: 'pip',
  label: 'Text focus + camera',
  blurb:
    'Big readable text, small camera in the corner. Best for long passages.',
  needs: { camera: true, screen: false, canvas: true },
  thumb: [
    { x: 0, y: 0, w: 160, h: 90, role: 'text' },
    { x: 116, y: 6, w: 38, h: 22, role: 'camera' },
  ],
  size: landscapeSize,
  draw(ctx, size, frame, state) {
    fillBackdrop(ctx, size)
    const pad = Math.round(size.height * 0.06)
    drawTextLayer(
      ctx,
      { x: pad, y: pad, w: size.width - pad * 2, h: size.height - pad * 2 },
      frame.text,
      { fontPx: size.height * 0.1, scale: state.textScale },
    )
    if (frame.camera)
      drawRoundedCover(
        ctx,
        frame.camera,
        pipRect(size),
        size.height * 0.02,
        state.mirror,
      )
  },
}
