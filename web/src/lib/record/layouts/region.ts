import { drawContain } from './draw'
import { landscapeSize } from './geometry'
import type { LayoutDef } from './types'

/** L7 — only the practice stage element (Element / Region Capture, Chromium). Recorded raw from the cropped tab track. */
export const regionLayout: LayoutDef = {
  id: 'region',
  label: 'Part of this page',
  blurb: 'Records just the practice stage, not the rest of your screen.',
  needs: { camera: false, screen: true, region: true },
  raw: true,
  thumb: [
    { x: 0, y: 0, w: 160, h: 90, role: 'screen' },
    { x: 30, y: 16, w: 100, h: 58, role: 'accent' },
  ],
  size: landscapeSize,
  draw(ctx, size, frame) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, size.width, size.height)
    if (frame.screen)
      drawContain(ctx, frame.screen, {
        x: 0,
        y: 0,
        w: size.width,
        h: size.height,
      })
  },
}
