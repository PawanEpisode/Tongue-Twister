import { beforeEach, describe, expect, it } from 'vitest'
import { detectCapabilities } from './capabilities'
import type { CapabilityEnv } from './capabilities'
import { DEFAULT_SETTINGS } from './settings'
import type { RecordSettings } from './settings'
import { SessionOpenError, openSession } from './session'
import type { SessionEvent, SessionInit } from './session'
import type { FakeTrack } from './testing/fakes'
import {
  FakeMediaRecorder,
  fakeMediaDevices,
  fakeSessionDeps,
  fakeStream,
  namedError,
} from './testing/fakes'

const fn = () => undefined
const caps = detectCapabilities({
  navigator: {
    userAgent: 'Mozilla/5.0 (X11; Linux) Chrome/126.0 Safari/537.36',
    mediaDevices: { getUserMedia: fn, getDisplayMedia: fn },
  },
  MediaRecorder: fn,
  HTMLCanvasElement: { prototype: { captureStream: fn } },
  AudioContext: fn,
  RestrictionTarget: {},
  indexedDB: {},
} satisfies CapabilityEnv)

const events: SessionEvent[] = []
const init = (
  over: Partial<RecordSettings> = {},
  extra: Partial<SessionInit> = {},
): SessionInit => ({
  settings: { ...DEFAULT_SETTINGS, ...over },
  twister: { slug: 'peter-piper', text: 'Peter Piper picked a peck' },
  owner: null,
  caps,
  getText: () => ({ words: [], current: -1, hits: [] }),
  getLayoutState: () => ({
    bubble: DEFAULT_SETTINGS.bubble,
    splitRatio: 0.5,
    textScale: 1,
    mirror: false,
  }),
  getPreviewMirror: () => true,
  onEvent: (e) => void events.push(e),
  regionElement: {} as Element,
  ...extra,
})

beforeEach(() => {
  FakeMediaRecorder.instances = []
  events.length = 0
})

const allTracks = (h: ReturnType<typeof fakeSessionDeps>) => [
  ...h.md.streams.flatMap((s) => s.getTracks()),
  ...h.mixers.map((m) => m.track).filter((t): t is FakeTrack => !!t),
  ...h.compositors.map((c) => c.track),
]

describe('session teardown (mode switching must leave no live tracks)', () => {
  it('dispose after preview stops the camera, mic, canvas and mixer tracks and the frame clock', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init(), h.deps)
    expect(allTracks(h).length).toBeGreaterThan(0)
    expect(allTracks(h).some((t) => !t.stopped)).toBe(true)
    expect(h.clock.running).toBe(true)
    s.dispose()
    expect(allTracks(h).every((t) => t.stopped)).toBe(true)
    expect(h.clock.running).toBe(false)
    expect(h.mixers.every((m) => m.disposed)).toBe(true)
    expect(h.compositors.every((c) => c.disposed)).toBe(true)
    expect(h.videos.every((v) => v.released)).toBe(true)
  })

  it('dispose in the middle of a recording also stops the recorder and releases the wake lock', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init(), h.deps)
    await s.begin()
    expect(FakeMediaRecorder.instances[0].state).toBe('recording')
    expect(h.wake.requests).toBe(1)
    s.dispose()
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive')
    expect(allTracks(h).every((t) => t.stopped)).toBe(true)
    expect(h.wake.released).toBe(1)
  })

  it('dispose is idempotent and silences device events afterwards', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init(), h.deps)
    const cam = h.md.streams[0].getVideoTracks()[0]
    s.dispose()
    s.dispose()
    cam.end()
    expect(events).toEqual([])
  })

  it('raw layouts (camera only) release everything too, without a canvas', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init({ layout: 'camera' }), h.deps)
    expect(s.composited).toBe(false)
    expect(h.compositors).toHaveLength(0)
    expect(s.previewStream).not.toBeNull()
    s.dispose()
    expect(allTracks(h).every((t) => t.stopped)).toBe(true)
  })

  it('a failed open leaves nothing running', async () => {
    const md = fakeMediaDevices([() => fakeStream('video', 'audio')])
    const h = fakeSessionDeps({ md })
    h.deps.createVideo = async () => {
      throw namedError('NotSupportedError')
    }
    await expect(openSession(init(), h.deps)).rejects.toBeInstanceOf(
      SessionOpenError,
    )
    expect(
      md.streams.flatMap((s) => s.getTracks()).every((t) => t.stopped),
    ).toBe(true)
  })
})

describe('session open', () => {
  it('a denied camera surfaces which device failed and leaves nothing open', async () => {
    const md = fakeMediaDevices([
      () => namedError('NotAllowedError'),
      () => namedError('NotAllowedError'),
      () => fakeStream('audio'),
    ])
    const h = fakeSessionDeps({ md })
    const err = await openSession(init(), h.deps).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SessionOpenError)
    const e = err as SessionOpenError
    expect(e.camera?.class).toBe('permission_denied')
    expect(e.mic).toBeNull()
    expect(
      md.streams.flatMap((s) => s.getTracks()).every((t) => t.stopped),
    ).toBe(true)
  })

  it('audio-only after a camera failure records a video of the waveform card', async () => {
    const md = fakeMediaDevices([() => fakeStream('audio')])
    const h = fakeSessionDeps({ md })
    const s = await openSession(
      init({ layout: 'camera' }, { audioOnly: true }),
      h.deps,
    )
    expect(s.hasCamera).toBe(false)
    expect(s.hasMic).toBe(true)
    expect(s.composited).toBe(true) // canvas fallback: still a valid video/webm
    expect(md.calls[0].video).toBeUndefined()
    s.dispose()
  })

  it('refuses layouts this browser cannot do', async () => {
    const h = fakeSessionDeps()
    const noScreen = detectCapabilities({ ...({} as CapabilityEnv) })
    await expect(
      openSession(
        init({ layout: 'screen_bubble' }, { caps: noScreen }),
        h.deps,
      ),
    ).rejects.toBeInstanceOf(SessionOpenError)
  })

  it('screen + bubble opens the screen picker and mixes its audio', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init({ layout: 'screen_bubble' }), h.deps)
    expect(s.hasScreen).toBe(true)
    expect(s.hasSystemAudio).toBe(true)
    expect(s.captureSource).toBe('getDisplayMedia')
    s.dispose()
  })

  it('negotiates the container from what the browser supports', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init(), h.deps)
    expect(s.mime).toBe('video/webm;codecs=vp8,opus')
    s.dispose()
  })
})

describe('session recording', () => {
  it('stores 1 s chunks as they arrive and returns a take with the right metadata', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init(), h.deps)
    await s.begin()
    const rec = FakeMediaRecorder.instances[0]
    h.advance(1000)
    rec.emit(100)
    h.advance(1000)
    rec.emit(100)
    const take = await s.stop('user')
    expect(take.id).toBe('take-1')
    expect(take.layout).toBe('camera_text')
    expect(take.durationMs).toBe(2000)
    expect(take.endedReason).toBe('user')
    expect(take.hasCamera && take.hasMic).toBe(true)
    expect(take.sizeBytes).toBeGreaterThan(200)
    expect(take.width).toBe(1280)
    // data is on disk (crash recovery) with the final status
    expect((await h.store.get('take-1'))?.status).toBe('stopped')
    s.dispose()
  })

  it('paused time is not part of the take', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init(), h.deps)
    await s.begin()
    h.advance(3000)
    s.pause()
    h.advance(60_000)
    s.resume()
    h.advance(2000)
    expect(s.elapsed()).toBe(5000)
    expect(FakeMediaRecorder.instances[0].state).toBe('recording')
    s.dispose()
  })

  it('restart discards the stored chunks and can begin again on the same preview', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init(), h.deps)
    await s.begin()
    FakeMediaRecorder.instances[0].emit()
    await s.discardTake()
    expect(await h.store.get('take-1')).toBeUndefined()
    expect(s.elapsed()).toBe(0)
    await s.begin()
    expect(FakeMediaRecorder.instances).toHaveLength(2)
    expect(await h.store.get('take-2')).toBeDefined()
    s.dispose()
  })

  it('reports a device that disappears', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init(), h.deps)
    h.md.streams[0].getVideoTracks()[0].end()
    h.md.streams[0].getAudioTracks()[0].end()
    expect(events).toEqual([
      { type: 'device_lost', kind: 'camera' },
      { type: 'device_lost', kind: 'mic' },
    ])
    s.dispose()
  })

  it('reports the browser "Stop sharing" bar as screen_stopped', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init({ layout: 'screen_bubble' }), h.deps)
    const screen = h.md.streams.find(
      (st) =>
        st.getVideoTracks().length &&
        st.getAudioTracks().length &&
        st !== h.md.streams[0],
    )
    screen?.getVideoTracks()[0].end()
    expect(events).toContainEqual({ type: 'screen_stopped' })
    s.dispose()
  })

  it('stop without begin is an error, not a hang', async () => {
    const h = fakeSessionDeps()
    const s = await openSession(init(), h.deps)
    await expect(s.stop('user')).rejects.toMatchObject({
      class: 'recorder_error',
    })
    s.dispose()
  })
})
