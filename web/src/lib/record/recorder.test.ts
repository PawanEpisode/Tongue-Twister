import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecorder } from './recorder'
import {
  FakeMediaRecorder,
  FakeRecorderCtor,
  namedError,
} from './testing/fakes'

beforeEach(() => {
  FakeMediaRecorder.instances = []
})

const make = (over: Partial<Parameters<typeof createRecorder>[0]> = {}) => {
  const chunks: { seq: number; elapsedMs: number; size: number }[] = []
  const errors: string[] = []
  let clock = 0
  const rec = createRecorder(
    {
      stream: {} as MediaStream,
      mime: 'video/webm;codecs=vp8,opus',
      videoBitsPerSecond: 2_000_000,
      audioBitsPerSecond: 128_000,
      elapsed: () => clock,
      sink: async (c) => {
        chunks.push({ seq: c.seq, elapsedMs: c.elapsedMs, size: c.data.size })
      },
      onError: (e) => errors.push(e.class),
      ...over,
    },
    FakeRecorderCtor,
  )
  const fake = FakeMediaRecorder.instances[0]
  return { rec, fake, chunks, errors, tick: (ms: number) => (clock = ms) }
}

describe('recorder', () => {
  it('passes the mime and bitrates to MediaRecorder and starts with 1 s slices', () => {
    const { rec, fake } = make()
    const start = vi.spyOn(fake, 'start')
    rec.start()
    expect(fake.options).toMatchObject({
      mimeType: 'video/webm;codecs=vp8,opus',
      videoBitsPerSecond: 2_000_000,
    })
    expect(start).toHaveBeenCalledWith(1000)
  })
  it('leaves the mime out to let the browser choose', () => {
    const { fake } = make({ mime: '' })
    expect(fake.options.mimeType).toBeUndefined()
  })
  it('numbers chunks and stamps them with the active clock', async () => {
    const { rec, fake, chunks, tick } = make()
    rec.start()
    tick(1000)
    fake.emit(10)
    tick(2000)
    fake.emit(20)
    await rec.stop() // adds the final chunk
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2])
    expect(chunks.slice(0, 2).map((c) => c.elapsedMs)).toEqual([1000, 2000])
  })
  it('ignores empty chunks', async () => {
    const { rec, fake, chunks } = make()
    rec.start()
    fake.ondataavailable?.({ data: new Blob([]) })
    await rec.stop()
    expect(chunks).toHaveLength(1) // only the final one
  })
  it('stop() resolves only after every chunk is written', async () => {
    const written: number[] = []
    const { rec, fake } = make({
      sink: async (c) => {
        await new Promise((r) => setTimeout(r, 10))
        written.push(c.seq)
      },
    })
    rec.start()
    fake.emit()
    fake.emit()
    await rec.stop()
    expect(written).toEqual([0, 1, 2])
  })
  it('stop is idempotent and safe on an inactive recorder', async () => {
    const { rec } = make()
    await rec.stop()
    await rec.stop()
  })
  it('pause and resume follow the recorder state', () => {
    const { rec, fake } = make()
    rec.start()
    rec.pause()
    expect(fake.state).toBe('paused')
    rec.pause() // no-op when not recording
    rec.resume()
    expect(fake.state).toBe('recording')
    rec.resume()
    expect(rec.state()).toBe('recording')
  })
  it('reports a recorder error once, as a taxonomy class', () => {
    const { rec, fake, errors } = make()
    rec.start()
    fake.onerror?.({ error: namedError('InvalidStateError') })
    fake.onerror?.({ error: namedError('InvalidStateError') })
    expect(errors).toEqual(['recorder_error'])
  })
  it('a full disk while writing a chunk becomes out_of_space', async () => {
    const { rec, fake, errors } = make({
      sink: async () => {
        throw namedError('QuotaExceededError')
      },
    })
    rec.start()
    fake.emit()
    await rec.stop()
    expect(errors).toEqual(['out_of_space'])
  })
  it('reports the container the browser really used', () => {
    const { rec, fake } = make()
    fake.mimeType = 'video/mp4'
    expect(rec.mimeType).toBe('video/mp4')
  })
  it('dispose detaches handlers and stops a live recorder', () => {
    const { rec, fake } = make()
    rec.start()
    rec.dispose()
    expect(fake.state).toBe('inactive')
    expect(fake.ondataavailable).toBeNull()
  })
})
