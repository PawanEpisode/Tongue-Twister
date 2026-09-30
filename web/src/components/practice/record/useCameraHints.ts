import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { faceHint, lightingHint, meanLuma } from '#/lib/record/hints'
import type { LightingHint } from '#/lib/record/hints'

type FaceDetectorLike = {
  detect: (src: CanvasImageSource) => Promise<unknown[]>
}
type FaceDetectorCtor = new (o?: { fastMode?: boolean }) => FaceDetectorLike

/**
 * Samples the visible preview once a second for lighting (and a face, where the browser has FaceDetector).
 * Runs locally on a tiny 32×18 copy; nothing is stored or sent (PRD 04 §9 "No biometrics").
 */
export function useCameraHints(
  host: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const [lighting, setLighting] = useState<LightingHint>('ok')
  const [noFace, setNoFace] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const scratch = document.createElement('canvas')
    scratch.width = 32
    scratch.height = 18
    const ctx = scratch.getContext('2d', { willReadFrequently: true })
    const Ctor = (globalThis as { FaceDetector?: FaceDetectorCtor })
      .FaceDetector
    const detector = Ctor ? new Ctor({ fastMode: true }) : null
    const seen: boolean[] = []
    let cancelled = false

    const tick = async () => {
      const el = host.current?.querySelector<
        HTMLCanvasElement | HTMLVideoElement
      >('canvas, video')
      if (!el || !ctx) return
      try {
        ctx.drawImage(el, 0, 0, 32, 18)
        setLighting(lightingHint(meanLuma(ctx.getImageData(0, 0, 32, 18).data)))
        if (detector) {
          const faces = await detector.detect(el)
          if (cancelled) return
          seen.push(faces.length > 0)
          if (seen.length > 6) seen.shift()
          setNoFace(faceHint(seen))
        }
      } catch {
        /* a frame that isn't ready yet, or a detector that fails: skip the hint */
      }
    }
    const id = setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [host, enabled])

  return { lighting, noFace }
}
