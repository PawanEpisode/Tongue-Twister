import { drawAudioCard, drawCover } from './draw'
import { landscapeSize } from './geometry'
import type { LayoutDef } from './types'

/** L1 — camera only. Recorded raw (no canvas); `draw` only runs for a take without a camera (audio-only). */
export const cameraLayout: LayoutDef = {
  id: 'camera',
  label: 'Camera only',
  blurb: 'Just you, full frame. Simplest and most compatible.',
  needs: { camera: true, screen: false },
  raw: true,
  thumb: [{ x: 0, y: 0, w: 160, h: 90, role: 'camera' }],
  size: landscapeSize,
  draw(ctx, size, frame, state) {
    if (frame.camera)
      drawCover(
        ctx,
        frame.camera,
        { x: 0, y: 0, w: size.width, h: size.height },
        state.mirror,
      )
    else drawAudioCard(ctx, size, frame.level, frame.elapsedMs)
  },
}
