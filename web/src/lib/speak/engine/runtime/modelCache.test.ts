import { describe, expect, it } from 'vitest'
import {
  ModelError,
  cachedModel,
  downloadModel,
  isCached,
  loadLabelMap,
  removeModels,
  labelMapUrl,
} from './modelCache'
import type { CacheDeps, ModelDescriptor } from './modelCache'

class FakeCache {
  store = new Map<string, Response>()
  async match(key: string) {
    const hit = this.store.get(key)
    return hit ? hit.clone() : undefined
  }
  async put(key: string, res: Response) {
    this.store.set(key, res)
  }
  async delete(key: string | Request) {
    return this.store.delete(
      typeof key === 'string' ? key : new URL(key.url).pathname,
    )
  }
  async keys() {
    return [...this.store.keys()].map(
      (k) => new Request(`https://app.example${k}`),
    )
  }
}
class FakeStorage {
  caches = new Map<string, FakeCache>()
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache())
    return this.caches.get(name)!
  }
  async delete(name: string) {
    return this.caches.delete(name)
  }
}

const bytes = new Uint8Array(1000).map((_, i) => i % 251)
const hex = (n: number) => String(n).padStart(64, '0')
const model = (over: Partial<ModelDescriptor> = {}): ModelDescriptor => ({
  name: 'm1',
  sha256: hex(1),
  url: 'https://cdn.example/models/m1/model.onnx',
  sizeBytes: bytes.length,
  labelMapVersion: 'lm-1',
  ...over,
})
const deps = (
  over: Partial<CacheDeps> & { body?: Uint8Array; status?: number } = {},
) => {
  const caches = new FakeStorage()
  const calls: string[] = []
  const d: CacheDeps = {
    caches: caches as unknown as CacheStorage,
    fetch: (async (url: string) => {
      calls.push(String(url))
      return new Response((over.body ?? bytes) as BodyInit, {
        status: over.status ?? 200,
        headers: { 'content-length': String((over.body ?? bytes).length) },
      })
    }) as unknown as typeof fetch,
    sha256: over.sha256 ?? (async () => hex(1)),
  }
  return { d, caches, calls }
}

describe('model cache', () => {
  it('downloads, verifies, caches and then serves from cache without the network', async () => {
    const { d, calls } = deps()
    const seen: number[] = []
    const got = await downloadModel(model(), d, {
      onProgress: (l) => seen.push(l),
    })
    expect(new Uint8Array(got)).toEqual(bytes)
    expect(seen.at(-1)).toBe(bytes.length)
    expect(await isCached(model(), d)).toBe(true)
    expect(new Uint8Array((await cachedModel(model(), d))!)).toEqual(bytes)
    expect(calls).toHaveLength(1)
  })
  it('refuses a model whose checksum differs and caches nothing', async () => {
    const { d } = deps({ sha256: async () => hex(9) })
    await expect(downloadModel(model(), d)).rejects.toMatchObject({
      code: 'hash',
    })
    expect(await isCached(model(), d)).toBe(false)
  })
  it('refuses wrong sizes (short, long) and http errors', async () => {
    await expect(
      downloadModel(model(), deps({ body: bytes.slice(0, 10) }).d),
    ).rejects.toMatchObject({ code: 'size' })
    await expect(
      downloadModel(model({ sizeBytes: 10 }), deps().d),
    ).rejects.toMatchObject({ code: 'size' })
    await expect(
      downloadModel(model(), deps({ status: 404 }).d),
    ).rejects.toMatchObject({ code: 'http' })
  })
  it('refuses insecure urls and reports network failure', async () => {
    await expect(
      downloadModel(model({ url: 'http://cdn.example/m.onnx' }), deps().d),
    ).rejects.toMatchObject({
      code: 'insecure_url',
    })
    const d = deps().d
    d.fetch = async () => {
      throw new TypeError('offline')
    }
    await expect(downloadModel(model(), d)).rejects.toMatchObject({
      code: 'network',
    })
  })
  it('stops when aborted', async () => {
    const ctl = new AbortController()
    ctl.abort()
    const d = deps().d
    d.fetch = async () => {
      throw new DOMException('aborted', 'AbortError')
    }
    await expect(
      downloadModel(model(), d, { signal: ctl.signal }),
    ).rejects.toMatchObject({ code: 'aborted' })
  })
  it('discards a tampered cache entry and evicts old versions only after the new one is stored', async () => {
    const { d, caches } = deps()
    await downloadModel(model(), d)
    const cache = await caches.open('twister-models-v1')
    cache.store.set(
      `/__twister_models__/${hex(1)}`,
      new Response(new Uint8Array(5), { headers: { 'x-sha256': hex(1) } }),
    )
    expect(await cachedModel(model(), d)).toBeNull()
    expect(cache.store.has(`/__twister_models__/${hex(1)}`)).toBe(false)
    await downloadModel(model(), d)
    await downloadModel(model({ sha256: hex(2) }), {
      ...d,
      sha256: async () => hex(2),
    })
    expect([...cache.store.keys()].some((k) => k.includes(hex(1)))).toBe(false)
    expect([...cache.store.keys()].some((k) => k.includes(hex(2)))).toBe(true)
  })
  it('can be wiped', async () => {
    const { d } = deps()
    await downloadModel(model(), d)
    await removeModels(d)
    expect(await isCached(model(), d)).toBe(false)
  })
  it('puts the label map next to the model and caches the validated copy', async () => {
    expect(labelMapUrl('https://cdn.example/models/m1/model.onnx')).toBe(
      'https://cdn.example/models/m1/label_map.json',
    )
    const lm = {
      version: 'lm-1',
      blank: '<pad>',
      vocab: ['<pad>', 'a'],
      classes: ['<b>', 'AA'],
      map: { a: 'AA' },
      drop: [],
    }
    const { d, calls } = deps()
    d.fetch = (async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify(lm))
    }) as unknown as typeof fetch
    expect((await loadLabelMap(model(), d)).classes).toEqual(['<b>', 'AA'])
    expect((await loadLabelMap(model(), d)).classes).toEqual(['<b>', 'AA'])
    expect(calls).toEqual(['https://cdn.example/models/m1/label_map.json'])
  })
  it('never caches an unusable label map', async () => {
    const { d } = deps()
    d.fetch = async () => new Response(JSON.stringify({ nope: true }))
    await expect(loadLabelMap(model(), d)).rejects.toBeInstanceOf(ModelError)
    await expect(loadLabelMap(model(), d)).rejects.toMatchObject({
      code: 'label_map',
    })
  })
})
