/**
 * One Record-mode media session: the camera / screen / mic streams, the audio mixer, the compositor, the
 * recorder and the chunk store, created together and torn down together. `dispose()` is the single exit:
 * it stops every track, closes the AudioContext, terminates the frame clock and releases the wake lock,
 * so switching modes or leaving the page can never leave a camera light on.
 *
 * Lifecycle: `openSession` (permissions + live preview, nothing recorded) → `begin` → pause/resume →
 * `stop` (returns the Take) → `dispose`.
 */
import type { CaptureSource, RecordingEndedReason } from '../api'
import { createAudioMixer } from './audioMixer'
import type { AudioMixer } from './audioMixer'
import { supportFor } from './capabilities'
import type { Capabilities } from './capabilities'
import { newMeta, openChunkStore } from './chunkStore'
import type { ChunkStore } from './chunkStore'
import { createCompositor } from './compositor'
import type { Compositor } from './compositor'
import { classify, errorOf } from './errors'
import type { RecordError } from './errors'
import { getLayout, usesCanvas } from './layouts'
import type { LayoutDef, LayoutState } from './layouts'
import type { FrameInputs, Size, TextLayer } from './layouts/types'
import { negotiateMime } from './mime'
import { AUDIO_BPS, FPS, videoBitrate } from './quality'
import { createRecorder } from './recorder'
import type { MediaRecorderCtor, RecorderHandle } from './recorder'
import type { RecordSettings } from './settings'
import {
  acquireScreen,
  acquireUserMedia,
  restrictToElement,
  stopStreams,
  watchTracks,
} from './sources'
import type { Acquired, MediaDevicesLike } from './sources'
import { createStopwatch } from './stopwatch'
import { takeFromStored } from './take'
import type { Take } from './take'

export type SessionEvent =
  | { type: 'device_lost'; kind: 'camera' | 'mic' }
  | { type: 'screen_stopped' }
  | { type: 'error'; error: RecordError }

/** Everything that touches the browser, injected so tests run with fakes. */
export type SessionDeps = {
  md: MediaDevicesLike
  MediaRecorderCtor: MediaRecorderCtor
  isTypeSupported: (type: string) => boolean
  createMixer: typeof createAudioMixer
  createCompositor: typeof createCompositor
  openStore: () => Promise<ChunkStore>
  newStream: (tracks: MediaStreamTrack[]) => MediaStream
  createVideo: (stream: MediaStream) => Promise<VideoLike>
  requestWakeLock: () => Promise<{ release: () => Promise<void> } | null>
  persistStorage: () => Promise<void>
  onVisibility: (fn: () => void) => () => void
  isHidden: () => boolean
  now: () => number
  uuid: () => string
}

export type VideoLike = CanvasImageSource & {
  videoWidth: number
  videoHeight: number
  release: () => void
}

export type SessionInit = {
  settings: RecordSettings
  twister: { slug: string; text: string }
  owner: string | null
  caps: Capabilities
  /** The user chose to record audio only after the camera failed. */
  audioOnly?: boolean
  /** The user chose to record without sound after the microphone failed. */
  noMic?: boolean
  /** L7: the element to record. */
  regionElement?: Element | null
  getText: () => TextLayer
  getLayoutState: () => LayoutState
  /** Whether the on-screen preview is mirrored (independent of the saved file). */
  getPreviewMirror: () => boolean
  onEvent: (e: SessionEvent) => void
}

export type Session = {
  readonly layout: LayoutDef
  readonly size: Size
  readonly composited: boolean
  readonly hasCamera: boolean
  readonly hasScreen: boolean
  readonly hasMic: boolean
  readonly hasSystemAudio: boolean
  readonly captureSource: CaptureSource
  readonly acquired: Acquired
  /** Raw layouts show this stream in a <video> (muted); composited ones draw to the preview canvas. */
  readonly previewStream: MediaStream | null
  readonly mime: string
  /** Composited layouts can swap in a reconnected camera; raw ones must finish. */
  readonly canReconnect: boolean
  level: () => number
  setPreviewCanvas: (c: HTMLCanvasElement | null) => void
  /** Prepare the recorder and start capturing at GO. */
  begin: () => Promise<void>
  pause: () => void
  resume: () => void
  elapsed: () => number
  /** Stop, assemble and return the finished take. */
  stop: (reason: RecordingEndedReason) => Promise<Take>
  /** Throw the current take away (restart / discard) but keep the live preview. */
  discardTake: () => Promise<void>
  /** Re-acquire a lost camera/mic and carry on (composited layouts). */
  reconnect: () => Promise<void>
  /** Screen sharing ended: keep recording with the camera full frame. */
  continueWithoutScreen: () => void
  dispose: () => void
}

export function browserDeps(): SessionDeps {
  return {
    md: navigator.mediaDevices,
    MediaRecorderCtor: MediaRecorder,
    isTypeSupported: (t) => MediaRecorder.isTypeSupported(t),
    createMixer: createAudioMixer,
    createCompositor,
    openStore: openChunkStore,
    newStream: (tracks) => new MediaStream(tracks),
    createVideo,
    requestWakeLock: async () => {
      try {
        return (await navigator.wakeLock?.request('screen')) ?? null
      } catch {
        return null // denied (low battery, hidden tab): recording still works
      }
    },
    persistStorage: async () => {
      try {
        await navigator.storage?.persist?.()
      } catch {
        /* best effort */
      }
    },
    onVisibility: (fn) => {
      document.addEventListener('visibilitychange', fn)
      return () => document.removeEventListener('visibilitychange', fn)
    },
    isHidden: () => document.hidden,
    now: () => performance.now(),
    uuid: () => crypto.randomUUID(),
  }
}

/** A hidden <video> that plays a stream so its frames can be drawn to the canvas. */
async function createVideo(stream: MediaStream): Promise<VideoLike> {
  const v = document.createElement('video')
  v.muted = true
  v.playsInline = true
  v.srcObject = stream
  await Promise.race([
    new Promise<void>((res) =>
      v.addEventListener('loadedmetadata', () => res(), { once: true }),
    ),
    new Promise<void>((res) => setTimeout(res, 2500)),
  ])
  await v.play().catch(() => undefined) // autoplay rules: muted video is allowed
  return Object.assign(v, {
    release() {
      v.pause()
      v.srcObject = null
    },
  })
}

class SetupError extends Error {
  constructor(readonly detail: RecordError) {
    super(detail.message)
    this.name = 'SetupError'
  }
}
/** Thrown by `openSession` when a device is missing; carries which one so the UI can offer a way forward. */
export class SessionOpenError extends Error {
  constructor(
    readonly error: RecordError,
    readonly camera: RecordError | null,
    readonly mic: RecordError | null,
  ) {
    super(error.message)
    this.name = 'SessionOpenError'
  }
}

export async function openSession(
  init: SessionInit,
  deps: SessionDeps,
): Promise<Session> {
  const { settings, caps } = init
  const layout = getLayout(settings.layout)
  const support = supportFor(caps, layout.needs)
  if (!support.ok)
    throw new SessionOpenError(
      { ...errorOf('unsupported'), message: support.reason },
      null,
      null,
    )

  const streams: MediaStream[] = []
  const videos: VideoLike[] = []
  let mixer: AudioMixer | null = null
  let compositor: Compositor | null = null
  let recorder: RecorderHandle | null = null
  let store: ChunkStore | null = null
  let previewCanvas: HTMLCanvasElement | null = null
  let unwatch: () => void = () => undefined
  let unVisibility: () => void = () => undefined
  let wakeLock: { release: () => Promise<void> } | null = null
  let takeId: string | null = null
  let disposed = false
  const watch = createStopwatch()

  const dispose = () => {
    if (disposed) return
    disposed = true
    unwatch()
    unVisibility()
    recorder?.dispose()
    compositor?.dispose()
    mixer?.dispose()
    videos.forEach((v) => v.release())
    stopStreams(...streams)
    void wakeLock?.release().catch(() => undefined)
    wakeLock = null
  }

  try {
    const wantsCamera = layout.needs.camera && !init.audioOnly
    const wantsMic = !init.noMic
    const acquired = await acquireUserMedia(deps.md, {
      camera: wantsCamera,
      mic: wantsMic,
      cameraId: settings.cameraId || undefined,
      micId: settings.micId || undefined,
      facing: caps.platform === 'desktop' ? undefined : settings.facing,
      resolution: settings.resolution,
      portrait: layout.portrait && caps.platform !== 'desktop',
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
    })
    if (acquired.stream) streams.push(acquired.stream)
    const camFail =
      acquired.camera && !acquired.camera.ok ? acquired.camera.error : null
    const micFail = acquired.mic && !acquired.mic.ok ? acquired.mic.error : null
    if (camFail || micFail) {
      // Partial success (e.g. mic granted, camera denied) is surfaced so the user can choose; nothing stays open.
      throw new SessionOpenError(
        camFail ?? (micFail as RecordError),
        camFail,
        micFail,
      )
    }

    const camera = acquired.stream && wantsCamera ? acquired.stream : null
    const micStream = acquired.stream
    const hasCamera = !!camera && camera.getVideoTracks().length > 0
    const hasMic = !!micStream && micStream.getAudioTracks().length > 0

    // Screen (L4 / L7).
    let screen: MediaStream | null = null
    let hasSystemAudio = false
    let captureSource: CaptureSource = 'getUserMedia'
    if (layout.needs.screen) {
      const s = await acquireScreen(deps.md, { region: !!layout.needs.region })
      streams.push(s.stream)
      screen = s.stream
      hasSystemAudio = s.hasAudio
      captureSource = 'getDisplayMedia'
      const track = s.stream.getVideoTracks()[0]
      if (layout.needs.region) {
        if (!init.regionElement || !caps.elementCapture || !track)
          throw new SetupError(errorOf('unsupported'))
        await restrictToElement(track, init.regionElement, caps.elementCapture)
        captureSource =
          caps.elementCapture === 'restriction'
            ? 'element_capture'
            : 'region_capture'
      }
    }

    // Frames for drawing.
    let cameraVideo: VideoLike | null =
      hasCamera && camera
        ? await deps.createVideo(deps.newStream(camera.getVideoTracks()))
        : null
    if (cameraVideo) videos.push(cameraVideo)
    let screenVideo: VideoLike | null =
      screen && !layout.raw
        ? await deps.createVideo(deps.newStream(screen.getVideoTracks()))
        : null
    if (screenVideo) videos.push(screenVideo)

    // One audio clock for everything we record.
    const audioInputs = [micStream, screen].filter(
      (s): s is MediaStream => !!s && s.getAudioTracks().length > 0,
    )
    mixer = deps.createMixer(audioInputs)

    const size = layout.size(settings.resolution)
    const composited = usesCanvas(layout, hasCamera)
    let recordStream: MediaStream
    let previewStream: MediaStream | null = null
    if (composited) {
      compositor = deps.createCompositor({
        layout,
        size,
        fps: FPS,
        frame: (): FrameInputs => ({
          camera: cameraVideo,
          screen: screenVideo,
          text: init.getText(),
          level: mixer?.level() ?? 0,
          elapsedMs: watch.elapsed(deps.now()),
        }),
        state: init.getLayoutState,
        previewMirror: init.getPreviewMirror,
        getPreview: () => previewCanvas,
      })
      const tracks = [compositor.videoTrack, mixer.track].filter(
        (t): t is MediaStreamTrack => !!t,
      )
      recordStream = deps.newStream(tracks)
      compositor.start()
    } else {
      const source = screen && layout.raw ? screen : camera
      const video = source?.getVideoTracks()[0]
      if (!video) throw new SetupError(errorOf('unsupported'))
      recordStream = deps.newStream([
        video,
        ...(mixer.track ? [mixer.track] : []),
      ])
      previewStream = deps.newStream([video])
    }
    // Device loss: a track that ends by itself.
    const cameraTracks = camera?.getVideoTracks() ?? []
    const micTracks = micStream?.getAudioTracks() ?? []
    const screenTracks = screen?.getVideoTracks() ?? []
    unwatch = watchTracks(
      [...cameraTracks, ...micTracks, ...screenTracks],
      (t) => {
        if (disposed) return
        if (screenTracks.includes(t)) init.onEvent({ type: 'screen_stopped' })
        else
          init.onEvent({
            type: 'device_lost',
            kind: t.kind === 'video' ? 'camera' : 'mic',
          })
      },
    )

    const { mime } = negotiateMime(deps.isTypeSupported)

    const session: Session = {
      layout,
      size,
      composited,
      hasCamera,
      hasScreen: !!screen,
      hasMic,
      hasSystemAudio,
      captureSource,
      acquired,
      previewStream,
      mime,
      canReconnect: composited,
      level: () => mixer?.level() ?? 0,
      setPreviewCanvas(c) {
        previewCanvas = c // read by the compositor on every frame
      },
      async begin() {
        if (disposed || !recordStream) return
        await mixer?.resume()
        store ??= await deps.openStore()
        takeId = deps.uuid()
        await store.create(
          newMeta({
            id: takeId,
            owner: init.owner,
            twister: init.twister.slug,
            twisterText: init.twister.text,
            layout: layout.id,
            mime,
            width: size.width,
            height: size.height,
            fps: FPS,
            hasCamera,
            hasScreen: !!screen,
            hasMic,
            hasSystemAudio,
            captureSource,
            layoutSettings: {
              bubble: settings.bubble,
              split_ratio: settings.splitRatio,
              text_scale: settings.textScale,
              mirror: settings.mirrorSaved,
            },
          }),
        )
        const id = takeId
        const s = store
        let lastMeta = 0
        recorder = createRecorder(
          {
            stream: recordStream,
            mime,
            videoBitsPerSecond: videoBitrate(size.width, size.height),
            audioBitsPerSecond: AUDIO_BPS,
            elapsed: () => watch.elapsed(deps.now()),
            sink: async ({ data, seq, elapsedMs }) => {
              await s.append(id, seq, data, elapsedMs)
              // Keep the meta's duration fresh every ~5 s so a crash still knows how long the take was.
              if (elapsedMs - lastMeta >= 5000) {
                lastMeta = elapsedMs
                await s.update(id, { durationMs: elapsedMs })
              }
            },
            onError: (e) => init.onEvent({ type: 'error', error: e }),
          },
          deps.MediaRecorderCtor,
        )
        watch.start(deps.now())
        recorder.start()
        void deps.persistStorage()
        wakeLock = await deps.requestWakeLock()
        // The OS drops a wake lock when the tab is hidden; take it back when the user returns.
        unVisibility()
        unVisibility = deps.onVisibility(() => {
          if (!deps.isHidden() && recorder && !wakeLock)
            void deps.requestWakeLock().then((l) => {
              wakeLock = l
            })
        })
      },
      pause() {
        if (!recorder) return
        recorder.pause()
        watch.pause(deps.now())
      },
      resume() {
        if (!recorder) return
        recorder.resume()
        watch.resume(deps.now())
      },
      elapsed: () => watch.elapsed(deps.now()),
      async stop(reason) {
        const rec = recorder
        const id = takeId
        const s = store
        if (!rec || !id || !s) throw errorOf('recorder_error')
        const ms = watch.elapsed(deps.now())
        watch.pause(deps.now())
        await rec.stop()
        recorder = null
        takeId = null
        void wakeLock?.release().catch(() => undefined)
        wakeLock = null
        unVisibility()
        unVisibility = () => undefined
        await s.update(id, {
          status: 'stopped',
          durationMs: ms,
          endedReason: reason,
          mime: rec.mimeType || mime,
        })
        const meta = await s.get(id)
        const assembled = await s.assemble(id)
        if (!meta || !assembled) throw errorOf('recorder_error')
        return takeFromStored({ ...meta, durationMs: ms }, assembled, false)
      },
      async discardTake() {
        const rec = recorder
        const id = takeId
        recorder = null
        takeId = null
        watch.reset()
        rec?.dispose()
        void wakeLock?.release().catch(() => undefined)
        wakeLock = null
        if (id && store) await store.remove(id).catch(() => undefined)
      },
      async reconnect() {
        const fresh = await acquireUserMedia(deps.md, {
          camera: wantsCamera,
          mic: wantsMic,
          cameraId: settings.cameraId || undefined,
          micId: settings.micId || undefined,
          resolution: settings.resolution,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
        })
        if (!fresh.stream)
          throw new SessionOpenError(errorOf('device_missing'), null, null)
        streams.push(fresh.stream)
        if (wantsCamera && fresh.stream.getVideoTracks().length) {
          const next = await deps.createVideo(
            deps.newStream(fresh.stream.getVideoTracks()),
          )
          cameraVideo?.release()
          cameraVideo = next
          videos.push(next)
          unwatch()
          unwatch = watchTracks(
            [...fresh.stream.getTracks(), ...screenTracks],
            (t) => {
              if (disposed) return
              if (screenTracks.includes(t))
                init.onEvent({ type: 'screen_stopped' })
              else
                init.onEvent({
                  type: 'device_lost',
                  kind: t.kind === 'video' ? 'camera' : 'mic',
                })
            },
          )
        }
        mixer?.addInput(fresh.stream)
      },
      continueWithoutScreen() {
        screenVideo?.release()
        screenVideo = null // the layout draws the camera full frame without a screen
      },
      dispose,
    }
    return session
  } catch (err) {
    dispose()
    if (err instanceof SessionOpenError) throw err
    if (err instanceof SetupError)
      throw new SessionOpenError(err.detail, null, null)
    throw new SessionOpenError(classify(err), null, null)
  }
}
