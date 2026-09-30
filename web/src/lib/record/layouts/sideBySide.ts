import { drawRoundedCover, fillBackdrop } from './draw'
import { landscapeSize, splitRects } from './geometry'
import { drawTextLayer } from './text'
import type { LayoutDef } from './types'

/** L3 — text on the left, camera on the right in a rounded panel. */
export const sideBySideLayout: LayoutDef = {
  id: 'side_by_side',
  label: 'Side by side',
  blurb: 'Twister text on the left, you on the right. Great for review clips.',
  needs: { camera: true, screen: false, canvas: true },
  thumb: [
    { x: 6, y: 6, w: 72, h: 78, role: 'text' },
    { x: 84, y: 6, w: 70, h: 78, role: 'camera' },
  ],
  size: landscapeSize,
  draw(ctx, size, frame, state) {
    fillBackdrop(ctx, size)
    const { text, camera } = splitRects(size, state.splitRatio)
    drawTextLayer(ctx, text, frame.text, {
      fontPx: size.height * 0.085,
      scale: state.textScale,
      align: 'left',
    })
    if (frame.camera)
      drawRoundedCover(
        ctx,
        frame.camera,
        camera,
        size.height * 0.035,
        state.mirror,
      )
  },
}
