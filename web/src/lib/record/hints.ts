/** Preview hints (PRD 04 §4.2): lighting and "face in frame". Local only, nothing is stored or sent. */

export type LightingHint = 'too_dark' | 'too_bright' | 'ok'

/** Mean luma 0–255 of RGBA pixels. */
export function meanLuma(rgba: ArrayLike<number>): number {
  const px = Math.floor(rgba.length / 4)
  if (!px) return 0
  let sum = 0
  for (let i = 0; i < px; i++) {
    const o = i * 4
    sum += 0.2126 * rgba[o] + 0.7152 * rgba[o + 1] + 0.0722 * rgba[o + 2]
  }
  return sum / px
}

export function lightingHint(luma: number): LightingHint {
  if (luma < 45) return 'too_dark'
  if (luma > 215) return 'too_bright'
  return 'ok'
}

export const LIGHTING_COPY: Record<Exclude<LightingHint, 'ok'>, string> = {
  too_dark: 'It’s a bit dark. Face a window or lamp so we can see your mouth.',
  too_bright:
    'It’s very bright. Move away from the light behind you or lower the glare.',
}

/** A face must be missing for this many samples in a row before we say anything (no flicker). */
export const FACE_MISSING_SAMPLES = 3

export function faceHint(history: readonly boolean[]): boolean {
  const recent = history.slice(-FACE_MISSING_SAMPLES)
  return recent.length === FACE_MISSING_SAMPLES && recent.every((seen) => !seen)
}
