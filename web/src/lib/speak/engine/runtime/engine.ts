/**
 * The Accurate-mode controller: one object that owns the model's whole lifecycle in this tab (check support ->
 * fetch manifest -> download/verify/cache -> start the inference worker -> benchmark -> ready) and exposes it as a
 * small immutable status the UI subscribes to. Everything environmental is injected, so the lifecycle is tested
 * with fakes: no browser, no network, no WASM.
 */
import {
  MAX_LATENCY_MS,
  benchClip,
  estimateLatencyMs,
  needsDownloadConsent,
  readBench,
  threadsFor,
  unsupportedReason,
  writeBench,
} from './deviceGate'
import type { Env, Unsupported } from './deviceGate'
import { parseManifest } from './manifest'
import type { EngineManifest } from './manifest'
import {
  ModelError,
  downloadModel,
  isCached,
  loadLabelMap,
  removeModels,
  cachedModel,
} from './modelCache'
import type { CacheDeps } from './modelCache'
import type { LabelMap } from './labelMap'
import { EngineWorkerError } from './ortClient'
import type { OrtClient } from './ortClient'
import { analyseRead } from './session'
import type { Analysis, ReadInput } from './session'

export type Unavailable =
  Unsupported | 'no_model' | 'manifest_failed' | 'server_off'

export type EngineStatus =
  | { state: 'checking' }
  | { state: 'unavailable'; reason: Unavailable }
  | {
      state: 'idle'
      sizeBytes: number
      cached: boolean
      /** The download should be confirmed first (cellular, Save-Data, slow link). */
      needsConsent: boolean
      modelName: string
    }
  | { state: 'downloading'; loaded: number; total: number }
  | { state: 'starting'; step: 'loading' | 'warming' }
  | { state: 'ready'; modelName: string; estimateMs: number; threads: number }
  | { state: 'error'; code: string; message: string; retryable: boolean }

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type EngineDeps = {
  env: () => Env
  /** Raw JSON from GET /engine/manifest/. */
  fetchManifest: () => Promise<unknown>
  cache: CacheDeps
  makeClient: () => OrtClient
  storage: KV | null
  now?: () => number
  perf?: () => number
}

const PREF_KEY = 'twister.accurate.enabled.v1'

export class AccurateEngine {
  private status: EngineStatus = { state: 'checking' }
  private listeners = new Set<() => void>()
  private manifest: EngineManifest | null = null
  private labelMap: LabelMap | null = null
  private client: OrtClient | null = null
  private starting: Promise<void> | null = null
  private abort: AbortController | null = null
  private serverOff = false

  constructor(private readonly deps: EngineDeps) {}

  // --- subscription (useSyncExternalStore) -------------------------------------------------------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getSnapshot = () => this.status
  private set(next: EngineStatus) {
    this.status = next
    for (const fn of [...this.listeners]) fn()
  }

  // --- preference ----------------------------------------------------------------------------------
  get enabled(): boolean {
    try {
      return this.deps.storage?.getItem(PREF_KEY) === '1'
    } catch {
      return false
    }
  }
  private setPref(on: boolean) {
    try {
      if (on) this.deps.storage?.setItem(PREF_KEY, '1')
      else this.deps.storage?.removeItem(PREF_KEY)
    } catch {
      /* storage blocked: the choice just doesn't persist across visits */
    }
  }

  // --- lifecycle -----------------------------------------------------------------------------------
  /** Work out what this device and server can do. Cheap; safe to call on every page that offers the mode. */
  async refresh(): Promise<void> {
    if (
      this.status.state === 'downloading' ||
      this.status.state === 'starting' ||
      this.status.state === 'ready'
    )
      return
    if (this.serverOff)
      return this.set({ state: 'unavailable', reason: 'server_off' })
    const env = this.deps.env()
    const reason = unsupportedReason(env)
    if (reason) return this.set({ state: 'unavailable', reason })
    let manifest: EngineManifest | null
    try {
      manifest = parseManifest(await this.deps.fetchManifest())
    } catch {
      return this.set({ state: 'unavailable', reason: 'manifest_failed' })
    }
    if (!manifest) return this.set({ state: 'unavailable', reason: 'no_model' })
    this.manifest = manifest
    const bench = readBench(
      this.deps.storage,
      manifest.model.sha256,
      threadsFor(env),
      this.deps.now?.(),
    )
    if (bench && bench.estimateMs > MAX_LATENCY_MS)
      return this.set({ state: 'unavailable', reason: 'too_slow' })
    const cached = await isCached(manifest.model, this.deps.cache).catch(
      () => false,
    )
    this.set({
      state: 'idle',
      sizeBytes: manifest.model.sizeBytes,
      cached,
      needsConsent: !cached && needsDownloadConsent(env),
      modelName: manifest.model.name,
    })
    // A returning user who turned it on and already has the file: no prompt, no download, just start.
    if (cached && this.enabled) await this.start().catch(() => undefined)
  }

  /** Turn Accurate mode on. Resolves when ready or failed (see the status). */
  async enable(
    opts: { consent?: boolean } = {},
  ): Promise<'started' | 'consent_needed' | 'unavailable'> {
    if (this.status.state === 'ready') return 'started'
    if (this.status.state === 'checking' || this.status.state === 'error')
      await this.refresh()
    const s = this.status
    if (s.state !== 'idle')
      return s.state === 'downloading' || s.state === 'starting'
        ? 'started'
        : 'unavailable'
    if (s.needsConsent && !opts.consent) return 'consent_needed'
    this.setPref(true)
    await this.start()
    return 'started'
  }

  private start(): Promise<void> {
    this.starting ??= this.run().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async run() {
    const manifest = this.manifest
    if (!manifest) return
    const env = this.deps.env()
    const threads = threadsFor(env)
    this.abort = new AbortController()
    const { signal } = this.abort
    try {
      let bytes = await cachedModel(manifest.model, this.deps.cache).catch(
        () => null,
      )
      if (!bytes) {
        this.set({
          state: 'downloading',
          loaded: 0,
          total: manifest.model.sizeBytes,
        })
        bytes = await downloadModel(manifest.model, this.deps.cache, {
          signal,
          onProgress: (loaded, total) =>
            this.set({ state: 'downloading', loaded, total }),
        })
      }
      this.set({ state: 'starting', step: 'loading' })
      this.labelMap = await loadLabelMap(manifest.model, this.deps.cache)
      this.client?.dispose()
      this.client = this.deps.makeClient()
      await this.client.init(bytes, threads, signal)

      let estimateMs = readBench(
        this.deps.storage,
        manifest.model.sha256,
        threads,
        this.deps.now?.(),
      )?.estimateMs
      if (estimateMs === undefined) {
        this.set({ state: 'starting', step: 'warming' })
        const perf = this.deps.perf ?? (() => performance.now())
        const t0 = perf()
        await this.client.run(benchClip(), signal)
        estimateMs = estimateLatencyMs(perf() - t0)
        writeBench(this.deps.storage, {
          sha256: manifest.model.sha256,
          threads,
          estimateMs,
          at: this.deps.now?.() ?? Date.now(),
        })
      }
      if (estimateMs > MAX_LATENCY_MS) {
        this.teardown()
        this.setPref(false)
        return this.set({ state: 'unavailable', reason: 'too_slow' })
      }
      this.set({
        state: 'ready',
        modelName: manifest.model.name,
        estimateMs,
        threads,
      })
    } catch (err) {
      this.teardown()
      if (err instanceof ModelError && err.code === 'aborted')
        return this.set(this.idleFrom(manifest))
      this.set(this.errorFor(err))
    } finally {
      this.abort = null
    }
  }

  private idleFrom(m: EngineManifest): EngineStatus {
    return {
      state: 'idle',
      sizeBytes: m.model.sizeBytes,
      cached: false,
      needsConsent: false,
      modelName: m.model.name,
    }
  }

  private errorFor(err: unknown): EngineStatus {
    if (err instanceof ModelError)
      return {
        state: 'error',
        code: err.code,
        message: ERROR_COPY[err.code] ?? 'Accurate mode could not start.',
        retryable: err.code !== 'insecure_url' && err.code !== 'label_map',
      }
    if (err instanceof EngineWorkerError)
      return {
        state: 'error',
        code: err.code,
        message:
          err.code === 'out_of_memory'
            ? ERROR_COPY.out_of_memory
            : 'Accurate mode could not start on this device.',
        retryable: err.code !== 'out_of_memory',
      }
    return {
      state: 'error',
      code: 'unknown',
      message: 'Accurate mode could not start.',
      retryable: true,
    }
  }

  private teardown() {
    this.client?.dispose()
    this.client = null
    this.labelMap = null
  }

  /** Turn it off: stop the worker and free memory; the downloaded file stays for next time. */
  disable() {
    this.setPref(false)
    this.abort?.abort()
    this.teardown()
    // refresh() returns early while 'ready', so step back to 'checking' first.
    this.set({ state: 'checking' })
    if (this.manifest) void this.refresh()
  }

  /** "Remove model": also delete the downloaded file. */
  async remove() {
    this.disable()
    await removeModels(this.deps.cache).catch(() => undefined)
    if (this.manifest) this.set({ ...this.idleFrom(this.manifest) })
  }

  /** The server refused device results (kill switch, retired model): stay basic for this session. */
  markServerOff() {
    this.serverOff = true
    this.teardown()
    this.set({ state: 'unavailable', reason: 'server_off' })
  }

  get ready(): boolean {
    return (
      this.status.state === 'ready' &&
      !!this.client &&
      !!this.labelMap &&
      !!this.manifest
    )
  }
  get modelVersion() {
    return this.manifest?.model.name ?? ''
  }
  get profileCode() {
    return this.manifest?.profileCode ?? ''
  }
  get modelSha256() {
    return this.manifest?.model.sha256 ?? ''
  }

  /** Raw inference timing for the calibration benchmark (no scoring, nothing sent anywhere). */
  async benchmarkRun(
    samples: Float32Array,
    signal?: AbortSignal,
  ): Promise<{ ms: number }> {
    if (!this.ready || !this.client)
      throw new Error('Accurate mode is not ready')
    const t0 = performance.now()
    await this.client.run(samples, signal)
    return { ms: performance.now() - t0 }
  }

  async analyse(
    input: Omit<ReadInput, 'profile' | 'labelMap'>,
    signal?: AbortSignal,
  ): Promise<Analysis> {
    if (!this.ready || !this.client || !this.labelMap || !this.manifest)
      throw new Error('Accurate mode is not ready')
    return analyseRead(
      this.client,
      { ...input, profile: this.manifest.profile, labelMap: this.labelMap },
      signal,
    )
  }
}

const ERROR_COPY: Record<string, string> = {
  network: 'The download was interrupted. Check your connection and try again.',
  http: 'The model could not be downloaded right now. Try again later.',
  size: 'The download looked wrong, so we discarded it. Try again.',
  hash: 'The download failed its integrity check, so we discarded it. Try again.',
  quota: 'Not enough free storage on this device for the model.',
  insecure_url: 'The model is not available over a secure connection.',
  label_map: 'The model files do not match. Try again later.',
  out_of_memory: 'This device does not have enough memory for Accurate mode.',
}
