/**
 * Should this device offer Accurate mode at all? Answers from cheap capability checks first, then one measured
 * warm-up (docs/features/13 section 3.2): a device that cannot score a 15 s read inside the ceiling is told so
 * once and stays on basic scoring, rather than making every take wait.
 */

/** Hard ceiling for scoring a 15 s read; above it Accurate mode is not offered (D33). */
export const MAX_LATENCY_MS = 8_000
/** The reference read the budget is expressed against. */
export const REFERENCE_CLIP_S = 15
/** Warm-up clip length: long enough to be representative, short enough to be unnoticeable. */
export const BENCH_CLIP_S = 5
/** Low-memory devices (navigator.deviceMemory, GB) are not offered a ~100 MB model. */
export const MIN_MEMORY_GB = 2

export type Connection = {
  type?: string
  effectiveType?: string
  saveData?: boolean
}
export type Env = {
  webAssembly: boolean
  simd: boolean
  worker: boolean
  mediaDevices: boolean
  audioWorklet: boolean
  cacheStorage: boolean
  crypto: boolean
  secureContext: boolean
  deviceMemory: number | null
  hardwareConcurrency: number
  crossOriginIsolated: boolean
  connection: Connection | null
}

export type Unsupported =
  | 'insecure_context'
  | 'no_webassembly'
  | 'no_simd'
  | 'no_worker'
  | 'no_microphone'
  | 'no_audio_worklet'
  | 'no_cache_storage'
  | 'no_crypto'
  | 'low_memory'
  | 'too_slow'

// Smallest valid module using a v128 instruction (the standard wasm-feature-detect probe).
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8,
  0, 65, 0, 253, 15, 253, 98, 11,
])

export function readEnv(g: typeof globalThis = globalThis): Env {
  const nav = (
    g as unknown as { navigator?: Navigator & Record<string, unknown> }
  ).navigator
  const wasm = (g as { WebAssembly?: typeof WebAssembly }).WebAssembly
  let simd = false
  try {
    simd = !!wasm && wasm.validate(SIMD_PROBE)
  } catch {
    simd = false
  }
  const memory = nav?.deviceMemory
  return {
    webAssembly: !!wasm,
    simd,
    worker: typeof (g as { Worker?: unknown }).Worker === 'function',
    mediaDevices:
      !!nav?.mediaDevices &&
      typeof nav.mediaDevices.getUserMedia === 'function',
    audioWorklet:
      typeof (g as { AudioWorkletNode?: unknown }).AudioWorkletNode ===
        'function' &&
      typeof (g as { AudioContext?: { prototype?: object } }).AudioContext ===
        'function',
    cacheStorage: !!(g as { caches?: unknown }).caches,
    crypto: !!(g as { crypto?: { subtle?: unknown } }).crypto?.subtle,
    secureContext:
      (g as { isSecureContext?: boolean }).isSecureContext !== false,
    deviceMemory: typeof memory === 'number' ? memory : null,
    hardwareConcurrency: Math.max(1, Math.floor(nav?.hardwareConcurrency ?? 1)),
    crossOriginIsolated: !!(g as { crossOriginIsolated?: boolean })
      .crossOriginIsolated,
    connection: (nav?.connection as Connection | undefined) ?? null,
  }
}

/** The first reason this browser/device cannot run the engine, or null. */
export function unsupportedReason(env: Env): Unsupported | null {
  if (!env.secureContext) return 'insecure_context'
  if (!env.webAssembly) return 'no_webassembly'
  if (!env.simd) return 'no_simd'
  if (!env.worker) return 'no_worker'
  if (!env.mediaDevices) return 'no_microphone'
  if (!env.audioWorklet) return 'no_audio_worklet'
  if (!env.cacheStorage) return 'no_cache_storage'
  if (!env.crypto) return 'no_crypto'
  if (env.deviceMemory !== null && env.deviceMemory < MIN_MEMORY_GB)
    return 'low_memory'
  return null
}

/** Threads for ONNX Runtime: multi-threaded WASM needs cross-origin isolation; otherwise one. */
export function threadsFor(env: Env): number {
  if (!env.crossOriginIsolated) return 1
  return Math.min(4, Math.max(1, env.hardwareConcurrency - 1))
}

/** A big download over cellular, a metered link or Save-Data is confirmed with the user first, never silent. */
export function needsDownloadConsent(env: Env): boolean {
  const c = env.connection
  if (!c) return false
  return (
    !!c.saveData ||
    c.type === 'cellular' ||
    c.effectiveType === 'slow-2g' ||
    c.effectiveType === '2g' ||
    c.effectiveType === '3g'
  )
}

/** Scale a measured warm-up to the reference read. Inference is linear in clip length (fixed per-run cost aside). */
export const estimateLatencyMs = (benchMs: number, benchClipS = BENCH_CLIP_S) =>
  Math.round((benchMs * REFERENCE_CLIP_S) / benchClipS)

export const fastEnough = (
  benchMs: number,
  benchClipS = BENCH_CLIP_S,
  ceilingMs = MAX_LATENCY_MS,
) =>
  Number.isFinite(benchMs) &&
  estimateLatencyMs(benchMs, benchClipS) <= ceilingMs

export type BenchRecord = {
  sha256: string
  threads: number
  estimateMs: number
  at: number
}
const BENCH_KEY = 'twister.accurate.bench.v1'
const BENCH_TTL_MS = 14 * 24 * 3600 * 1000

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** A recent measurement for this exact model + thread count, so the warm-up runs once per device, not per visit. */
export function readBench(
  storage: KV | null,
  sha256: string,
  threads: number,
  now = Date.now(),
): BenchRecord | null {
  try {
    const raw = storage?.getItem(BENCH_KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as Partial<BenchRecord>
    if (
      r.sha256 !== sha256 ||
      r.threads !== threads ||
      typeof r.estimateMs !== 'number' ||
      !Number.isFinite(r.estimateMs) ||
      typeof r.at !== 'number' ||
      now - r.at > BENCH_TTL_MS ||
      r.at > now + 60_000
    )
      return null
    return r as BenchRecord
  } catch {
    return null
  }
}

export function writeBench(storage: KV | null, record: BenchRecord) {
  try {
    storage?.setItem(BENCH_KEY, JSON.stringify(record))
  } catch {
    /* storage blocked: we just measure again next time */
  }
}

/** A deterministic, speech-like synthetic clip (so the benchmark needs no recording). */
export function benchClip(seconds = BENCH_CLIP_S, rate = 16_000): Float32Array {
  const out = new Float32Array(Math.floor(seconds * rate))
  let seed = 12345
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    const noise = seed / 0xffffffff - 0.5
    const t = i / rate
    out[i] =
      0.2 *
        Math.sin(2 * Math.PI * 140 * t) *
        (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)) +
      0.05 * noise
  }
  return out
}
