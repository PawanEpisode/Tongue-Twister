/** MediaRecorder container/codec negotiation (PRD 04 §6). Pure: `isTypeSupported` is injected. */

export const MIME_CHAIN = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
] as const

export type Container = 'webm' | 'mp4' | 'unknown'
export type MimeChoice = {
  /** Value for `new MediaRecorder(stream, { mimeType })`; '' = let the browser choose. */
  mime: string
  container: Container
}

export function containerOf(mime: string): Container {
  const base = mime.split(';')[0].trim().toLowerCase()
  if (base === 'video/webm' || base === 'audio/webm') return 'webm'
  if (base === 'video/mp4' || base === 'audio/mp4') return 'mp4'
  return 'unknown'
}

export const extensionFor = (mime: string): string =>
  containerOf(mime) === 'mp4' ? 'mp4' : 'webm'

/** The first type in the chain the browser can record, else the browser's own default. */
export function negotiateMime(
  isTypeSupported: ((type: string) => boolean) | undefined,
): MimeChoice {
  if (isTypeSupported) {
    for (const mime of MIME_CHAIN) {
      let ok = false
      try {
        ok = isTypeSupported(mime)
      } catch {
        ok = false
      }
      if (ok) return { mime, container: containerOf(mime) }
    }
  }
  return { mime: '', container: 'unknown' }
}
