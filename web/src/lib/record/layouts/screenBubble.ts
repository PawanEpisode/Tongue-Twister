import { drawCircleCover, drawContain, drawCover } from './draw'
import { bubbleRect, landscapeSize } from './geometry'
import type { LayoutDef } from './types'

/** L4 — screen / window / tab full frame with a circular camera bubble the user can drag and resize. Desktop only. */
export const screenBubbleLayout: LayoutDef = {
  id: 'screen_bubble',
  label: 'Screen + camera bubble',
  blurb: 'Share a screen, window or tab with your face in a bubble.',
  needs: { camera: true, screen: true, canvas: true },
  thumb: [
    { x: 0, y: 0, w: 160, h: 90, role: 'screen' },
    { x: 116, y: 46, w: 36, h: 36, role: 'camera', round: true },
  ],
  size: landscapeSize,
  draw(ctx, size, frame, state) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, size.width, size.height)
    const full = { x: 0, y: 0, w: size.width, h: size.height }
    if (frame.screen) {
      drawContain(ctx, frame.screen, full)
      if (frame.camera)
        drawCircleCover(
          ctx,
          frame.camera,
          bubbleRect(size, state.bubble),
          state.mirror,
        )
    } else if (frame.camera) {
      // Screen sharing stopped: carry on with the camera full frame.
      drawCover(ctx, frame.camera, full, state.mirror)
    }
  },
}
