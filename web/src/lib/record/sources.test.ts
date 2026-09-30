import { describe, expect, it } from 'vitest'
import {
  acquireScreen,
  acquireUserMedia,
  listDevices,
  restrictToElement,
  videoRungs,
  watchTracks,
} from './sources'
import type { DeviceRequest } from './sources'
import {
  FakeTrack,
  fakeMediaDevices,
  fakeStream,
  namedError,
} from './testing/fakes'
import { classify } from './errors'

const req = (over: Partial<DeviceRequest> = {}): DeviceRequest => ({
  camera: true,
  mic: true,
  resolution: 'auto',
  echoCancellation: true,
  noiseSuppression: true,
  ...over,
})

describe('videoRungs', () => {
  it('goes 1080p → 720p → any camera, and adds "any device" when a device id was pinned', () => {
    expect(videoRungs({ resolution: '1080p' }).map((r) => r.level)).toEqual([
      '1080p',
      '720p',
      'basic',
    ])
    expect(videoRungs({ resolution: 'auto' }).map((r) => r.level)).toEqual([
      '720p',
      'basic',
    ])
    expect(
      videoRungs({ resolution: 'auto', cameraId: 'cam1' }).map((r) => r.level),
    ).toEqual(['720p', 'basic', 'basic'])
    expect(
      videoRungs({ resolution: 'auto', cameraId: 'cam1' })[0].constraints
        .deviceId,
    ).toEqual({ exact: 'cam1' })
  })
  it('asks for a vertical frame in portrait', () => {
    const c = videoRungs({ resolution: 'auto', portrait: true })[0].constraints
    expect(c.width).toEqual({ ideal: 720 })
    expect(c.height).toEqual({ ideal: 1280 })
  })
})

describe('acquireUserMedia', () => {
  it('asks for camera and microphone in one request', async () => {
    const md = fakeMediaDevices([() => fakeStream('video', 'audio')])
    const got = await acquireUserMedia(md, req())
    expect(md.calls).toHaveLength(1)
    expect(md.calls[0].audio).toBeTruthy()
    expect(md.calls[0].video).toBeTruthy()
    expect(got.camera).toEqual({ ok: true })
    expect(got.mic).toEqual({ ok: true })
    expect(got.downgraded).toBeNull()
  })

  it('falls back to a lower resolution on OverconstrainedError and says so', async () => {
    const md = fakeMediaDevices([
      () => namedError('OverconstrainedError'),
      () => fakeStream('video', 'audio'),
    ])
    const got = await acquireUserMedia(md, req({ resolution: '1080p' }))
    expect(md.calls).toHaveLength(2)
    expect(got.downgraded).toBe('720p')
    expect(got.camera).toEqual({ ok: true })
  })

  it('does not retry other errors on the same ladder', async () => {
    const md = fakeMediaDevices([() => namedError('NotAllowedError')])
    const got = await acquireUserMedia(md, req({ mic: false }))
    expect(md.calls).toHaveLength(1)
    expect(got.stream).toBeNull()
    expect(got.camera).toMatchObject({ ok: false })
    expect(got.camera && !got.camera.ok && got.camera.error.class).toBe(
      'permission_denied',
    )
  })

  it('when both fail together, reports camera and mic separately (camera denied, mic fine)', async () => {
    const md = fakeMediaDevices([
      () => namedError('NotAllowedError'), // combined
      () => namedError('NotAllowedError'), // camera alone
      () => fakeStream('audio'), // mic alone
    ])
    const got = await acquireUserMedia(md, req())
    expect(got.camera && !got.camera.ok && got.camera.error.class).toBe(
      'permission_denied',
    )
    expect(got.mic).toEqual({ ok: true })
    expect(got.stream?.getAudioTracks()).toHaveLength(1)
  })

  it('camera busy but mic fine → device_busy for the camera only', async () => {
    const md = fakeMediaDevices([
      () => namedError('NotReadableError'),
      () => namedError('NotReadableError'),
      () => fakeStream('audio'),
    ])
    const got = await acquireUserMedia(md, req())
    expect(got.camera && !got.camera.ok && got.camera.error.class).toBe(
      'device_busy',
    )
    expect(got.mic?.ok).toBe(true)
  })

  it('camera fine but mic missing → keeps the camera stream', async () => {
    const md = fakeMediaDevices([
      () => namedError('NotFoundError'),
      () => fakeStream('video'),
      () => namedError('NotFoundError'),
    ])
    const got = await acquireUserMedia(md, req())
    expect(got.camera?.ok).toBe(true)
    expect(got.mic && !got.mic.ok && got.mic.error.class).toBe('device_missing')
    expect(got.stream?.getVideoTracks()).toHaveLength(1)
  })

  it('audio-only request does not touch the camera', async () => {
    const md = fakeMediaDevices([() => fakeStream('audio')])
    const got = await acquireUserMedia(md, req({ camera: false }))
    expect(md.calls[0].video).toBeUndefined()
    expect(got.camera).toBeNull()
    expect(got.mic?.ok).toBe(true)
  })

  it('a request for nothing opens nothing', async () => {
    const md = fakeMediaDevices([() => fakeStream('audio')])
    const got = await acquireUserMedia(md, req({ camera: false, mic: false }))
    expect(md.calls).toHaveLength(0)
    expect(got.stream).toBeNull()
  })
})

describe('acquireScreen', () => {
  it('reports whether tab/system audio came along', async () => {
    const md = fakeMediaDevices([() => fakeStream('video')])
    const s = await acquireScreen(md, { region: false })
    expect(s.hasAudio).toBe(true) // the fake display stream carries audio
  })
  it('treats cancelling the picker as its own, gentle error', async () => {
    const md = {
      ...fakeMediaDevices([]),
      getDisplayMedia: async () => {
        throw namedError('NotAllowedError')
      },
    }
    await expect(acquireScreen(md, { region: false })).rejects.toSatisfy(
      (e) => classify(e).class === 'screen_cancelled',
    )
  })
  it('fails clearly when the browser has no getDisplayMedia', async () => {
    const md = { getUserMedia: fakeMediaDevices([]).getUserMedia }
    await expect(acquireScreen(md, { region: false })).rejects.toSatisfy(
      (e) => classify(e).class === 'unsupported',
    )
  })
  it('asks for the current tab when recording part of the page', async () => {
    let seen: unknown
    const md = {
      ...fakeMediaDevices([]),
      getDisplayMedia: async (o?: unknown) => {
        seen = o
        return fakeStream('video') as unknown as MediaStream
      },
    }
    await acquireScreen(md, { region: true })
    expect(seen).toMatchObject({ preferCurrentTab: true })
  })
})

describe('restrictToElement (Element / Region Capture)', () => {
  const el = {} as Element
  it('uses Element Capture (restrictTo) when available', async () => {
    const calls: unknown[] = []
    const track = {
      restrictTo: async (t: unknown) => void calls.push(t),
    } as unknown as MediaStreamTrack
    await restrictToElement(track, el, 'restriction', {
      RestrictionTarget: { fromElement: async () => 'target' },
    })
    expect(calls).toEqual(['target'])
  })
  it('falls back to Region Capture (cropTo)', async () => {
    const calls: unknown[] = []
    const track = {
      cropTo: async (t: unknown) => void calls.push(t),
    } as unknown as MediaStreamTrack
    await restrictToElement(track, el, 'crop', {
      CropTarget: { fromElement: async () => 'crop' },
    })
    expect(calls).toEqual(['crop'])
  })
  it('throws "unsupported" when the track cannot be restricted', async () => {
    await expect(
      restrictToElement({} as MediaStreamTrack, el, 'restriction', {}),
    ).rejects.toSatisfy((e) => classify(e).class === 'unsupported')
  })
})

describe('watchTracks', () => {
  it('fires when a device disappears, not when we stop it ourselves', () => {
    const a = new FakeTrack('video')
    const b = new FakeTrack('audio')
    const lost: string[] = []
    const off = watchTracks([a, b] as unknown as MediaStreamTrack[], (t) =>
      lost.push(t.kind),
    )
    a.stop() // our own teardown: no event
    b.end() // unplugged
    expect(lost).toEqual(['audio'])
    off()
    b.end()
    expect(lost).toEqual(['audio'])
  })
})

describe('listDevices', () => {
  it('labels unlabelled devices and skips ones without ids', async () => {
    const md = {
      ...fakeMediaDevices([]),
      enumerateDevices: async () =>
        [
          { kind: 'videoinput', deviceId: 'c1', label: '' },
          { kind: 'videoinput', deviceId: 'c2', label: 'Logitech' },
          { kind: 'audioinput', deviceId: 'm1', label: 'Built-in' },
          { kind: 'audioinput', deviceId: '', label: 'ghost' },
          { kind: 'audiooutput', deviceId: 's1', label: 'speakers' },
        ] as MediaDeviceInfo[],
    }
    expect(await listDevices(md)).toEqual({
      cameras: [
        { id: 'c1', label: 'Camera 1' },
        { id: 'c2', label: 'Logitech' },
      ],
      mics: [{ id: 'm1', label: 'Built-in' }],
    })
  })
})
