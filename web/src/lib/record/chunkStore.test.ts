import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import {
  GUEST_RETENTION_MS,
  createIdbChunkStore,
  createMemoryChunkStore,
  isRecoverable,
  newMeta,
} from './chunkStore'
import type { ChunkStore, StoredMeta } from './chunkStore'

let n = 0
const meta = (over: Partial<StoredMeta> = {}, now = 1_000_000): StoredMeta => ({
  ...newMeta(
    {
      id: `take-${++n}`,
      owner: null,
      twister: 'peter-piper',
      twisterText: 'Peter Piper picked a peck',
      layout: 'camera_text',
      mime: 'video/webm;codecs=vp8,opus',
      width: 1280,
      height: 720,
      fps: 30,
      hasCamera: true,
      hasScreen: false,
      hasMic: true,
      hasSystemAudio: false,
      captureSource: 'getUserMedia',
      layoutSettings: {},
    },
    now,
  ),
  ...over,
})
const blob = (s: string) => new Blob([s], { type: 'video/webm' })
const text = async (b: Blob) => new TextDecoder().decode(await b.arrayBuffer())

const suites: [string, () => ChunkStore][] = [
  ['IndexedDB', () => createIdbChunkStore(`test-${++n}`)],
  ['memory fallback', () => createMemoryChunkStore()],
]

describe.each(suites)('chunk store (%s)', (_name, make) => {
  it('assembles chunks in order, even when written out of order', async () => {
    const store = make()
    const m = meta()
    await store.create(m)
    await store.append(m.id, 1, blob('BB'), 2000)
    await store.append(m.id, 0, blob('AA'), 1000)
    await store.append(m.id, 2, blob('CC'), 3000)
    const out = await store.assemble(m.id)
    expect(out?.chunks).toBe(3)
    expect(await text(out?.blob as Blob)).toBe('AABBCC')
    expect(out?.durationMs).toBe(3000)
    expect(out?.blob.type).toBe('video/webm;codecs=vp8,opus')
  })

  it('keeps takes apart', async () => {
    const store = make()
    const a = meta()
    const b = meta()
    await store.create(a)
    await store.create(b)
    await store.append(a.id, 0, blob('A'), 1000)
    await store.append(b.id, 0, blob('B'), 1000)
    expect(await text((await store.assemble(a.id))?.blob as Blob)).toBe('A')
    expect(await text((await store.assemble(b.id))?.blob as Blob)).toBe('B')
  })

  it('recovers an orphan: status "recording" left on disk is listed with its data', async () => {
    const store = make()
    const m = meta()
    await store.create(m)
    await store.append(m.id, 0, blob('x'), 1000)
    const orphans = (await store.list()).filter((x) =>
      isRecoverable(x, null, 2_000_000),
    )
    expect(orphans.map((o) => o.id)).toContain(m.id)
    expect(orphans.find((o) => o.id === m.id)?.status).toBe('recording')
  })

  it('updates meta and removes everything for a take', async () => {
    const store = make()
    const m = meta()
    await store.create(m)
    await store.append(m.id, 0, blob('x'), 500)
    await store.update(m.id, { status: 'stopped', durationMs: 4000 })
    expect((await store.get(m.id))?.status).toBe('stopped')
    expect((await store.assemble(m.id))?.durationMs).toBe(4000)
    await store.remove(m.id)
    expect(await store.get(m.id)).toBeUndefined()
    expect(await store.assemble(m.id)).toBeNull()
  })

  it('has nothing to assemble for a take with no chunks', async () => {
    const store = make()
    const m = meta()
    await store.create(m)
    expect(await store.assemble(m.id)).toBeNull()
    expect(await store.assemble('missing')).toBeNull()
  })

  it('guest takes expire after 24 h and are purged; signed-in takes are kept', async () => {
    const store = make()
    const guest = meta({}, 1_000_000)
    const user = meta({ owner: 'u1', expiresAt: null }, 1_000_000)
    await store.create(guest)
    await store.create(user)
    expect(guest.expiresAt).toBe(1_000_000 + GUEST_RETENTION_MS)
    expect(
      await store.purgeExpired(1_000_000 + GUEST_RETENTION_MS - 1),
    ).toEqual([])
    expect(await store.purgeExpired(1_000_000 + GUEST_RETENTION_MS)).toEqual([
      guest.id,
    ])
    expect(await store.get(guest.id)).toBeUndefined()
    expect(await store.get(user.id)).toBeDefined()
  })
})

describe('isRecoverable', () => {
  const now = 5_000_000
  it('offers unsaved, unexpired takes to their owner and to guests', () => {
    expect(
      isRecoverable(meta({ owner: 'u1', expiresAt: null }), 'u1', now),
    ).toBe(true)
    expect(
      isRecoverable(meta({ owner: 'u1', expiresAt: null }), 'u2', now),
    ).toBe(false)
    expect(
      isRecoverable(meta({ owner: null, expiresAt: now + 10 }), 'u2', now),
    ).toBe(true)
    expect(
      isRecoverable(meta({ owner: null, expiresAt: now - 10 }), null, now),
    ).toBe(false)
    expect(
      isRecoverable(meta({ status: 'saved', expiresAt: null }), null, now),
    ).toBe(false)
  })
})
