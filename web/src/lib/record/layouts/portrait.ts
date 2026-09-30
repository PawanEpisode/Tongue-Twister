import { drawAudioCard, drawCover } from './draw'
import { lowerThird, portraitSize } from './geometry'
import { drawTextLayer } from './text'
import type { LayoutDef } from './types'

/** L6 — vertical 9:16 for social sharing: full-frame camera with a text card. */
export const portraitLayout: LayoutDef = {
  id: 'portrait',
  label: 'Portrait 9:16',
  blurb: 'Vertical video for phones and social.',
  needs: { camera: true, screen: false, canvas: true },
  portrait: true,
  thumb: [
    { x: 0, y: 0, w: 90, h: 160, role: 'camera' },
    { x: 6, y: 106, w: 78, h: 48, role: 'text' },
  ],
  size: portraitSize,
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
      fontPx: size.width * 0.075,
      scale: state.textScale,
      card: true,
    })
  },
}
