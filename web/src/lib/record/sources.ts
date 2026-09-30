/**
 * Capture sources: camera + microphone, screen/tab/window, and element capture of our own page.
 * All device access lives here so the failure ladder (denied / busy / missing / overconstrained,
 * separate camera and mic outcomes, device loss) is in one testable place.
 */
import { classify, errorOf } from './errors'
import type { RecordError } from './errors'
import { FPS, pixels } from './quality'
import type { Resolution } from './quality'
import type { ElementCapture } from './capabilities'

export type MediaDevicesLike = Pick<MediaDevices, 'getUserMedia'> &
  Partial<
    Pick<
      MediaDevices,
      | 'getDisplayMedia'
      | 'enumerateDevices'
      | 'addEventListener'
      | 'removeEventListener'
    >
  >

export type DeviceRequest = {
  camera: boolean
  mic: boolean
  cameraId?: string
  micId?: string
  facing?: 'user' | 'environment'
  resolution: Resolution
  /** Portrait layouts ask the camera for a vertical frame on phones. */
  portrait?: boolean
  echoCancellation: boolean
  noiseSuppression: boolean
}

export type DeviceOutcome = { ok: true } | { ok: false; error: RecordError }
export type Acquired = {
  /** All granted tracks in one stream; null if nothing could be opened. */
  stream: MediaStream | null
  camera: DeviceOutcome | null // null = not requested
  mic: DeviceOutcome | null
  /** Set when we had to fall back to a smaller resolution than asked for (tell the user). */
  downgraded: Resolution | 'basic' | null
}

const errName = (e: unknown) => (e instanceof Error ? e.name : '')

/** Camera constraint rungs, best first; the last rung is "whatever the camera gives". */
export function videoRungs(
  req: Pick<DeviceRequest, 'cameraId' | 'facing' | 'resolution' | 'portrait'>,
): { constraints: MediaTrackConstraints; level: Resolution | 'basic' }[] {
  const device: MediaTrackConstraints = req.cameraId
    ? { deviceId: { exact: req.cameraId } }
    : req.facing
      ? { facingMode: req.facing }
      : {}
  const dims = (res: Resolution): MediaTrackConstraints => {
    const p = pixels(res)
    return req.portrait
      ? { width: { ideal: p.short }, height: { ideal: p.long } }
      : { width: { ideal: p.long }, height: { ideal: p.short } }
  }
  const rung = (res: Resolution): MediaTrackConstraints => ({
    ...device,
    ...dims(res),
    frameRate: { ideal: FPS },
  })
  const out: {
    constraints: MediaTrackConstraints
    level: Resolution | 'basic'
  }[] = []
  if (req.resolution === '1080p')
    out.push({ constraints: rung('1080p'), level: '1080p' })
  out.push({ constraints: rung('720p'), level: '720p' })
  out.push({
    constraints: { ...device, frameRate: { ideal: FPS } },
    level: 'basic',
  })
  // The chosen device may be gone (unplugged since last visit): last resort, any camera.
  if (req.cameraId) out.push({ constraints: {}, level: 'basic' })
  return out
}

const audioConstraints = (req: DeviceRequest): MediaTrackConstraints => ({
  ...(req.micId ? { deviceId: { exact: req.micId } } : {}),
  echoCancellation: req.echoCancellation,
  noiseSuppression: req.noiseSuppression,
  autoGainControl: true,
})

async function tryVideo(
  md: MediaDevicesLike,
  req: DeviceRequest,
  audio: MediaTrackConstraints | false,
): Promise<{ stream: MediaStream; level: Resolution | 'basic' }> {
  let last: unknown
  for (const rung of videoRungs(req)) {
    try {
      const stream = await md.getUserMedia({ video: rung.constraints, audio })
      return { stream, level: rung.level }
    } catch (err) {
      last = err
      if (errName(err) !== 'OverconstrainedError') break // only resolution problems are worth another rung
    }
  }
  throw last
}

/**
 * Open camera and/or microphone. Asks for both at once (one browser prompt); if that fails, probes them
 * separately so the UI can say *which* one is the problem and offer audio-only or camera-without-sound.
 */
export async function acquireUserMedia(
  md: MediaDevicesLike,
  req: DeviceRequest,
): Promise<Acquired> {
  const wantsRes = req.resolution === '1080p' ? '1080p' : '720p'
  const audio = req.mic ? audioConstraints(req) : false

  if (!req.camera && !req.mic)
    return { stream: null, camera: null, mic: null, downgraded: null }

  try {
    if (req.camera) {
      const { stream, level } = await tryVideo(md, req, audio)
      return {
        stream,
        camera: { ok: true },
        mic: req.mic ? { ok: true } : null,
        downgraded: level === wantsRes ? null : level,
      }
    }
    const stream = await md.getUserMedia({ audio: audioConstraints(req) })
    return { stream, camera: null, mic: { ok: true }, downgraded: null }
  } catch (combined) {
    if (!(req.camera && req.mic)) {
      const error = classify(combined)
      return {
        stream: null,
        camera: req.camera ? { ok: false, error } : null,
        mic: req.mic ? { ok: false, error } : null,
        downgraded: null,
      }
    }
  }

  // Both were wanted and the combined request failed: find out which side is broken.
  const parts: MediaStream[] = []
  let camera: DeviceOutcome
  let mic: DeviceOutcome
  let downgraded: Acquired['downgraded'] = null
  try {
    const v = await tryVideo(md, req, false)
    parts.push(v.stream)
    camera = { ok: true }
    downgraded = v.level === wantsRes ? null : v.level
  } catch (err) {
    camera = { ok: false, error: classify(err) }
  }
  try {
    parts.push(await md.getUserMedia({ audio: audioConstraints(req) }))
    mic = { ok: true }
  } catch (err) {
    mic = { ok: false, error: classify(err) }
  }
  return { stream: mergeStreams(parts), camera, mic, downgraded }
}

/** One stream from the tracks of several (they stay owned by whoever stops them). */
export function mergeStreams(
  parts: readonly MediaStream[],
): MediaStream | null {
  const tracks = parts.flatMap((s) => s.getTracks())
  if (!tracks.length) return null
  if (parts.length === 1) return parts[0]
  return new MediaStream(tracks)
}

export type ScreenResult = {
  stream: MediaStream
  /** Tab or system audio came with the picture. */
  hasAudio: boolean
}

type DisplayOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean
  selfBrowserSurface?: 'include' | 'exclude'
}

/** The native picker: whole screen, window or tab. Cancelling is not an error worth alarming about. */
export async function acquireScreen(
  md: MediaDevicesLike,
  opts: { region: boolean },
): Promise<ScreenResult> {
  if (!md.getDisplayMedia) throw errorOfThrow('unsupported')
  const options: DisplayOptions = {
    video: { frameRate: { ideal: FPS } },
    audio: true,
    ...(opts.region
      ? { preferCurrentTab: true, selfBrowserSurface: 'include' as const }
      : {}),
  }
  try {
    const stream = await md.getDisplayMedia(options)
    return { stream, hasAudio: stream.getAudioTracks().length > 0 }
  } catch (err) {
    if (errName(err) === 'NotAllowedError' || errName(err) === 'AbortError')
      throw errorOfThrow('screen_cancelled')
    throw err
  }
}

/** Throwable carrying a taxonomy entry; `classify` recognises it. */
function errorOfThrow(cls: 'unsupported' | 'screen_cancelled'): Error {
  const e = errorOf(cls)
  const err = new Error(e.message)
  err.name = cls === 'unsupported' ? 'UnsupportedLayout' : 'ScreenCancelled'
  return err
}

type TargetFactory = { fromElement: (el: Element) => Promise<unknown> }
type Restrictable = {
  restrictTo?: (t: unknown) => Promise<void>
  cropTo?: (t: unknown) => Promise<void>
}

/**
 * Element Capture (`restrictTo`) or Region Capture (`cropTo`): limit a *current-tab* capture track to one
 * element. Throws when the track cannot be restricted, so the caller can fall back or explain.
 */
export async function restrictToElement(
  track: MediaStreamTrack,
  element: Element,
  mode: Exclude<ElementCapture, null>,
  g: {
    RestrictionTarget?: TargetFactory
    CropTarget?: TargetFactory
  } = globalThis as {
    RestrictionTarget?: TargetFactory
    CropTarget?: TargetFactory
  },
): Promise<void> {
  const t = track as MediaStreamTrack & Restrictable
  if (mode === 'restriction' && g.RestrictionTarget && t.restrictTo) {
    await t.restrictTo(await g.RestrictionTarget.fromElement(element))
    return
  }
  if (g.CropTarget && t.cropTo) {
    await t.cropTo(await g.CropTarget.fromElement(element))
    return
  }
  throw errorOfThrow('unsupported')
}

export type DeviceList = {
  cameras: { id: string; label: string }[]
  mics: { id: string; label: string }[]
}

/** Labels are empty until the user has granted access once; the UI then shows "Camera 1", "Camera 2". */
export async function listDevices(md: MediaDevicesLike): Promise<DeviceList> {
  const all = (await md.enumerateDevices?.()) ?? []
  const pick = (kind: MediaDeviceKind, fallback: string) =>
    all
      .filter((d) => d.kind === kind && d.deviceId)
      .map((d, i) => ({
        id: d.deviceId,
        label: d.label || `${fallback} ${i + 1}`,
      }))
  return {
    cameras: pick('videoinput', 'Camera'),
    mics: pick('audioinput', 'Microphone'),
  }
}

/**
 * Tell us when a device goes away: a track that ends by itself (unplugged, permission revoked, browser
 * "Stop sharing"). `stop()`ping a track ourselves does not fire `ended`, so no false alarms on teardown.
 * Returns the unsubscribe function.
 */
export function watchTracks(
  tracks: readonly MediaStreamTrack[],
  onEnded: (track: MediaStreamTrack) => void,
): () => void {
  const handlers = tracks.map((track) => {
    const handler = () => onEnded(track)
    track.addEventListener('ended', handler)
    return { track, handler }
  })
  return () =>
    handlers.forEach((h) => h.track.removeEventListener('ended', h.handler))
}

/** Stop every track of every stream. Idempotent. */
export function stopStreams(
  ...streams: (MediaStream | null | undefined)[]
): void {
  for (const s of streams) s?.getTracks().forEach((t) => t.stop())
}
