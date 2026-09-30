/** Test doubles for the browser media APIs. Only used by tests; nothing here touches a real device. */
import type { AudioMixer } from '../audioMixer'
import type { ChunkStore } from '../chunkStore'
import { createMemoryChunkStore } from '../chunkStore'
import type { Compositor } from '../compositor'
import type { FrameClock } from '../frameClock'
import type { MediaRecorderCtor } from '../recorder'
import type { SessionDeps, VideoLike } from '../session'
import type { MediaDevicesLike } from '../sources'

export class FakeTrack {
  stopped = false
  readyState: 'live' | 'ended' = 'live'
  private handlers = new Set<() => void>()
  constructor(
    readonly kind: 'audio' | 'video',
    readonly label = kind,
  ) {}
  addEventListener(type: string, fn: () => void) {
    if (type === 'ended') this.handlers.add(fn)
  }
  removeEventListener(type: string, fn: () => void) {
    if (type === 'ended') this.handlers.delete(fn)
  }
  stop() {
    this.stopped = true
    this.readyState = 'ended' // like the browser: stop() does not fire "ended"
  }
  /** The device went away by itself (unplugged, "Stop sharing"). */
  end() {
    this.readyState = 'ended'
    this.handlers.forEach((h) => h())
  }
  getSettings() {
    return {}
  }
}

export class FakeStream {
  constructor(private tracks: FakeTrack[] = []) {}
  getTracks() {
    return this.tracks
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }
}

export const asStream = (s: FakeStream) => s as unknown as MediaStream
export const fakeStream = (...kinds: ('audio' | 'video')[]) =>
  new FakeStream(kinds.map((k) => new FakeTrack(k)))

export type FakeMediaDevices = MediaDevicesLike & {
  calls: MediaStreamConstraints[]
  streams: FakeStream[]
}

/** getUserMedia that can be scripted per call. */
export function fakeMediaDevices(
  script: ((c: MediaStreamConstraints) => FakeStream | Error)[],
): FakeMediaDevices {
  const calls: MediaStreamConstraints[] = []
  const streams: FakeStream[] = []
  let i = 0
  return {
    calls,
    streams,
    async getUserMedia(c?: MediaStreamConstraints) {
      calls.push(c ?? {})
      const step = script[Math.min(i++, script.length - 1)](c ?? {})
      if (step instanceof Error) throw step
      streams.push(step)
      return asStream(step)
    },
    async getDisplayMedia() {
      const s = fakeStream('video', 'audio')
      streams.push(s)
      return asStream(s)
    },
  }
}

export const namedError = (name: string, message = name) => {
  const e = new Error(message)
  e.name = name
  return e
}

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  state: RecordingState = 'inactive'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onstop: (() => void) | null = null
  constructor(
    readonly stream: unknown,
    readonly options: MediaRecorderOptions = {},
  ) {
    this.mimeType = options.mimeType ?? 'video/webm'
    FakeMediaRecorder.instances.push(this)
  }
  start() {
    this.state = 'recording'
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
  /** Emit a chunk as the browser would each timeslice. */
  emit(bytes = 8) {
    this.ondataavailable?.({
      data: new Blob([new Uint8Array(bytes)], { type: this.mimeType }),
    })
  }
  stop() {
    this.emit(4)
    this.state = 'inactive'
    this.onstop?.()
  }
}
export const FakeRecorderCtor =
  FakeMediaRecorder as unknown as MediaRecorderCtor

export class ManualClock implements FrameClock {
  running = false
  private tick: (() => void) | null = null
  start(_fps: number, onTick: () => void) {
    this.running = true
    this.tick = onTick
  }
  stop() {
    this.running = false
    this.tick = null
  }
  fire(times = 1) {
    for (let i = 0; i < times; i++) this.tick?.()
  }
}

export class FakeCtx {
  calls: string[] = []
  fillStyle = ''
  strokeStyle = ''
  lineWidth = 0
  font = ''
  textBaseline = ''
  textAlign = ''
  measureText(s: string) {
    return { width: s.length * 10 }
  }
  createLinearGradient() {
    return { addColorStop: () => undefined }
  }
  private rec(name: string) {
    return (..._a: unknown[]) => {
      this.calls.push(name)
    }
  }
  save = this.rec('save')
  restore = this.rec('restore')
  beginPath = this.rec('beginPath')
  closePath = this.rec('closePath')
  moveTo = this.rec('moveTo')
  arcTo = this.rec('arcTo')
  arc = this.rec('arc')
  clip = this.rec('clip')
  fill = this.rec('fill')
  stroke = this.rec('stroke')
  fillRect = this.rec('fillRect')
  fillText = this.rec('fillText')
  drawImage = this.rec('drawImage')
  translate = this.rec('translate')
  scale = this.rec('scale')
}
export const asCtx = (c: FakeCtx) => c as unknown as CanvasRenderingContext2D

export function fakeCanvas() {
  const ctx = new FakeCtx()
  const videoTrack = new FakeTrack('video')
  const stream = new FakeStream([videoTrack])
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    captureStream: () => asStream(stream),
  }
  return { canvas: canvas as unknown as HTMLCanvasElement, ctx, videoTrack }
}

export class FakeMixer {
  disposed = false
  inputs: unknown[] = []
  constructor(readonly track: FakeTrack | null) {}
  level = () => 0.2
  setGain = () => undefined
  addInput = (s: unknown) => void this.inputs.push(s)
  resume = async () => undefined
  dispose = () => {
    this.disposed = true
    this.track?.stop()
  }
  analyser = {} as AnalyserNode
}

/** A full set of session dependencies backed by fakes; returns handles for assertions. */
export function fakeSessionDeps(
  opts: { md?: FakeMediaDevices; store?: ChunkStore } = {},
) {
  const clock = new ManualClock()
  const md = opts.md ?? fakeMediaDevices([() => fakeStream('video', 'audio')])
  const store = opts.store ?? createMemoryChunkStore()
  const mixers: FakeMixer[] = []
  const compositors: { disposed: boolean; track: FakeTrack }[] = []
  const videos: { released: boolean }[] = []
  const wake = { requests: 0, released: 0 }
  let t = 0
  let n = 0
  const deps: SessionDeps = {
    md,
    MediaRecorderCtor: FakeRecorderCtor,
    isTypeSupported: (type) => type === 'video/webm;codecs=vp8,opus',
    createMixer: ((inputs: MediaStream[]) => {
      const hasAudio = inputs.some((s) => s.getAudioTracks().length)
      const m = new FakeMixer(hasAudio ? new FakeTrack('audio') : null)
      mixers.push(m)
      return m as unknown as AudioMixer
    }) as SessionDeps['createMixer'],
    createCompositor: (o) => {
      const { canvas, videoTrack } = fakeCanvas()
      const rec = { disposed: false, track: videoTrack }
      compositors.push(rec)
      const c: Compositor = {
        canvas,
        videoTrack: videoTrack as unknown as MediaStreamTrack,
        start: () => clock.start(30, () => undefined),
        renderNow: () => undefined,
        stop: () => clock.stop(),
        dispose: () => {
          rec.disposed = true
          videoTrack.stop()
          clock.stop()
        },
      }
      void o
      return c
    },
    openStore: async () => store,
    newStream: (tracks) =>
      asStream(new FakeStream(tracks as unknown as FakeTrack[])),
    createVideo: async () => {
      const v = {
        videoWidth: 640,
        videoHeight: 360,
        released: false,
      } as unknown as VideoLike & {
        released: boolean
      }
      const rec = { released: false }
      videos.push(rec)
      v.release = () => {
        rec.released = true
      }
      return v
    },
    requestWakeLock: async () => {
      wake.requests++
      return {
        release: async () => {
          wake.released++
        },
      }
    },
    persistStorage: async () => undefined,
    onVisibility: () => () => undefined,
    isHidden: () => false,
    now: () => t,
    uuid: () => `take-${++n}`,
  }
  return {
    deps,
    clock,
    md,
    store,
    mixers,
    compositors,
    videos,
    wake,
    advance: (ms: number) => {
      t += ms
    },
  }
}
