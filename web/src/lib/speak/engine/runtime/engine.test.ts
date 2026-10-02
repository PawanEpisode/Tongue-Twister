import { describe, expect, it } from 'vitest'
import { AccurateEngine } from './engine'
import type { EngineDeps } from './engine'
import type { Env } from './deviceGate'
import { EngineWorkerError } from './ortClient'
import type { OrtClient } from './ortClient'

const env: Env = {
  webAssembly: true,
  simd: true,
  worker: true,
  mediaDevices: true,
  audioWorklet: true,
  cacheStorage: true,
  crypto: true,
  secureContext: true,
  deviceMemory: 8,
  hardwareConcurrency: 8,
  crossOriginIsolated: false,
  connection: null,
}
const bytes = new Uint8Array(64).map((_, i) => i)
const sha = 'b'.repeat(64)
const manifest = {
  model: {
    name: 'm1',
    sha256: sha,
    size_bytes: 64,
    url: 'https://cdn.example/models/m1/model.onnx',
    label_map_version: 'lm',
  },
  scoring_profile: { code: 'p1', thresholds: {} },
  lexicon_version: 1,
  score_version: 2,
}
const labelMap = {
  version: 'lm',
  blank: '<pad>',
  vocab: ['<pad>', 'a'],
  classes: ['<b>', 'AA'],
  map: { a: 'AA' },
  drop: [],
}

class FakeCache {
  store = new Map<string, Response>()
  async match(k: string) {
    return this.store.get(k)?.clone()
  }
  async put(k: string, r: Response) {
    this.store.set(k, r)
  }
  async delete(k: string | Request) {
    return this.store.delete(
      typeof k === 'string' ? k : new URL(k.url).pathname,
    )
  }
  async keys() {
    return [...this.store.keys()].map(
      (k) => new Request(`https://app.example${k}`),
    )
  }
}
function setup(
  over: {
    env?: Partial<Env>
    benchMs?: number
    initError?: Error
    manifest?: unknown
    fetchFails?: boolean
  } = {},
) {
  const caches = new Map<string, FakeCache>()
  const store = new Map<string, string>()
  const events: string[] = []
  let clock = 0
  const client = {
    init: async () => {
      events.push('init')
      if (over.initError) throw over.initError
      return 5
    },
    run: async () => {
      events.push('run')
      clock += over.benchMs ?? 1000
      return { logits: new Float32Array(), frames: 0, vocab: 2, ms: 1 }
    },
    dispose: () => void events.push('dispose'),
  } as unknown as OrtClient
  const deps: EngineDeps = {
    env: () => ({ ...env, ...over.env }),
    fetchManifest: async () => {
      if (over.fetchFails) throw new Error('offline')
      return over.manifest === undefined ? manifest : over.manifest
    },
    cache: {
      caches: {
        open: async (n: string) => {
          if (!caches.has(n)) caches.set(n, new FakeCache())
          return caches.get(n)
        },
        delete: async (n: string) => caches.delete(n),
      } as unknown as CacheStorage,
      fetch: (async (url: string) =>
        String(url).endsWith('label_map.json')
          ? new Response(JSON.stringify(labelMap))
          : new Response(bytes, {
              headers: { 'content-length': '64' },
            })) as unknown as typeof fetch,
      sha256: async () => sha,
    },
    makeClient: () => client,
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    },
    now: () => 1_700_000_000_000,
    perf: () => clock,
  }
  return { engine: new AccurateEngine(deps), events, store }
}

describe('AccurateEngine lifecycle', () => {
  it('goes checking -> idle -> downloading -> ready and remembers the choice', async () => {
    const { engine, events, store } = setup()
    const seen: string[] = []
    engine.subscribe(() => seen.push(engine.getSnapshot().state))
    await engine.refresh()
    expect(engine.getSnapshot()).toMatchObject({
      state: 'idle',
      cached: false,
      needsConsent: false,
      sizeBytes: 64,
    })
    expect(await engine.enable()).toBe('started')
    expect(engine.getSnapshot()).toMatchObject({
      state: 'ready',
      modelName: 'm1',
      threads: 1,
    })
    expect(seen).toEqual(
      expect.arrayContaining(['idle', 'downloading', 'starting', 'ready']),
    )
    expect(events).toEqual(['init', 'run', 'run'])
    expect(store.get('twister.accurate.enabled.v1')).toBe('1')
    expect(engine.ready).toBe(true)
    expect(engine.modelVersion).toBe('m1')
  })
  it('asks for consent before a download on a metered connection, and honours it', async () => {
    const { engine } = setup({ env: { connection: { saveData: true } } })
    await engine.refresh()
    expect(engine.getSnapshot()).toMatchObject({
      state: 'idle',
      needsConsent: true,
    })
    expect(await engine.enable()).toBe('consent_needed')
    expect(engine.getSnapshot().state).toBe('idle')
    expect(await engine.enable({ consent: true })).toBe('started')
    expect(engine.getSnapshot().state).toBe('ready')
  })
  it('is unavailable on unsupported browsers, with no manifest, or when the manifest call fails', async () => {
    const a = setup({ env: { simd: false } })
    await a.engine.refresh()
    expect(a.engine.getSnapshot()).toEqual({
      state: 'unavailable',
      reason: 'no_simd',
    })
    expect(await a.engine.enable()).toBe('unavailable')
    const b = setup({ manifest: { model: null, scoring_profile: null } })
    await b.engine.refresh()
    expect(b.engine.getSnapshot()).toEqual({
      state: 'unavailable',
      reason: 'no_model',
    })
    const c = setup({ fetchFails: true })
    await c.engine.refresh()
    expect(c.engine.getSnapshot()).toEqual({
      state: 'unavailable',
      reason: 'manifest_failed',
    })
  })
  it('turns itself off, and forgets the choice, when the device is too slow', async () => {
    const { engine, store, events } = setup({ benchMs: 3000 }) // 5 s clip in 3 s -> 9 s per 15 s read
    await engine.refresh()
    await engine.enable()
    expect(engine.getSnapshot()).toEqual({
      state: 'unavailable',
      reason: 'too_slow',
    })
    expect(store.get('twister.accurate.enabled.v1')).toBeUndefined()
    expect(events).toContain('dispose')
  })
  it('reports start-up failures with a reason and lets the user retry', async () => {
    const { engine } = setup({
      initError: new EngineWorkerError('out_of_memory', 'oom'),
    })
    await engine.refresh()
    await engine.enable()
    expect(engine.getSnapshot()).toMatchObject({
      state: 'error',
      code: 'out_of_memory',
      retryable: false,
    })
    expect(engine.ready).toBe(false)
  })
  it('starts by itself for a returning user whose model is already cached', async () => {
    const first = setup()
    await first.engine.refresh()
    await first.engine.enable()
    // second visit: same storage and cache, new engine object
    const deps2 = (first.engine as unknown as { deps: EngineDeps }).deps
    const again = new AccurateEngine(deps2)
    await again.refresh()
    expect(again.getSnapshot().state).toBe('ready')
  })
  it('stays basic for the session once the server says no', async () => {
    const { engine } = setup()
    await engine.refresh()
    await engine.enable()
    engine.markServerOff()
    expect(engine.getSnapshot()).toEqual({
      state: 'unavailable',
      reason: 'server_off',
    })
    await engine.refresh()
    expect(engine.getSnapshot()).toEqual({
      state: 'unavailable',
      reason: 'server_off',
    })
    expect(engine.ready).toBe(false)
  })
  it('disable frees the worker and returns to idle; analyse refuses when not ready', async () => {
    const { engine, events } = setup()
    await engine.refresh()
    await engine.enable()
    engine.disable()
    await new Promise((r) => setTimeout(r, 0))
    expect(events).toContain('dispose')
    expect(engine.getSnapshot().state).toBe('idle')
    await expect(
      engine.analyse({
        samples: new Float32Array(10),
        captureRate: 48000,
        words: [],
        focus: [],
        difficulty: 2,
      }),
    ).rejects.toThrow('not ready')
  })
})
