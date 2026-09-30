/** A small JPEG poster of a take, for the recordings list (the API takes one in `complete`). Browser only. */
import { THUMBNAIL_MAX_BYTES, base64Bytes } from './cloud'

const WIDTH = 480

function loaded(
  video: HTMLVideoElement,
  event: string,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer)
      video.removeEventListener(event, onEvent)
      resolve(ok)
    }
    const onEvent = () => done(true)
    const timer = setTimeout(() => done(false), timeoutMs)
    video.addEventListener(event, onEvent, { once: true })
  })
}

export async function thumbnailFromBlob(
  blob: Blob,
  durationMs: number,
): Promise<string | null> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  try {
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
    if (!(await loaded(video, 'loadeddata', 4000))) return null
    const at = Math.min(1, durationMs / 2000)
    video.currentTime = at
    if (!(await loaded(video, 'seeked', 3000))) return null
    const canvas = document.createElement('canvas')
    const ratio = video.videoHeight / Math.max(1, video.videoWidth)
    canvas.width = WIDTH
    canvas.height = Math.round(WIDTH * (ratio || 9 / 16))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    for (const q of [0.75, 0.6, 0.45, 0.3]) {
      const data = canvas.toDataURL('image/jpeg', q)
      if (base64Bytes(data) <= THUMBNAIL_MAX_BYTES) return data
    }
    return null
  } catch {
    return null // a missing poster is fine
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}
