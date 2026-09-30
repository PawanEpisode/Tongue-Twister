import { drawAudioCard, drawCover } from './draw'
import { landscapeSize, lowerThird } from './geometry'
import { drawTextLayer } from './text'
import type { LayoutDef } from './types'

/** L2 — camera full frame with a semi-transparent text card in the lower third (the default). */
export const cameraTextLayout: LayoutDef = {
  id: 'camera_text',
  label: 'Camera + text card',
  blurb: 'You, with the twister lighting up along the bottom.',
  needs: { camera: true, screen: false, canvas: true },
  thumb: [
    { x: 0, y: 0, w: 160, h: 90, role: 'camera' },
    { x: 10, y: 56, w: 140, h: 26, role: 'text' },
  ],
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
    drawTextLayer(ctx, lowerThird(size), frame.text, {
      fontPx: size.height * 0.075,
      scale: state.textScale,
      card: true,
    })
  },
}
