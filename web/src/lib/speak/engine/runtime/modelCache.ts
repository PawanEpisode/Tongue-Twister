/**
 * The model file lives in Cache Storage keyed by its sha-256 (D39): downloaded once, verified before first use,
 * old versions evicted only after the new one verifies. A corrupt, partial or wrong-size entry is never used.
 * Everything browser-specific is injected, so the whole thing is unit-tested without a browser.
 */
import { parseLabelMap } from './labelMap'
import type { LabelMap, LabelMapError } from './labelMap'

export type ModelDescriptor = {
  name: string
  sha256: string
  url: string
  sizeBytes: number
  labelMapVersion: string
}

export type ModelErrorCode =
  | 'network'
  | 'http'
  | 'size'
  | 'hash'
  | 'quota'
  | 'aborted'
  | 'label_map'
  | 'insecure_url'

export class ModelError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ModelError'
  }
}

export type CacheDeps = {
  caches: CacheStorage
  fetch: typeof fetch
  sha256: (bytes: ArrayBuffer) => Promise<string>
}

const CACHE_NAME = 'twister-models-v1'
const keyFor = (sha: string) => `/__twister_models__/${sha}`
const labelKeyFor = (sha: string, version: string) =>
  `/__twister_models__/${sha}.labels.${encodeURIComponent(version)}.json`

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export const browserDeps = (): CacheDeps => ({
  caches,
  fetch: (...a) => fetch(...a),
  sha256: sha256Hex,
})

/** The label map is published next to the model file (jobs.label_map_url on the server). */
export const labelMapUrl = (modelUrl: string) =>
  modelUrl.slice(0, modelUrl.lastIndexOf('/') + 1) + 'label_map.json'

function requireHttps(url: string) {
  const u = new URL(url, 'https://invalid.example')
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:'))
    throw new ModelError('insecure_url', 'the model must be served over https')
}

/** The cached model if present and intact, else null. */
export async function cachedModel(
  m: ModelDescriptor,
  deps: CacheDeps,
): Promise<ArrayBuffer | null> {
  const cache = await deps.caches.open(CACHE_NAME)
  const hit = await cache.match(keyFor(m.sha256))
  if (!hit) return null
  const bytes = await hit.arrayBuffer()
  if (
    hit.headers.get('x-sha256') !== m.sha256 ||
    bytes.byteLength !== m.sizeBytes
  ) {
    await cache.delete(keyFor(m.sha256))
    return null
  }
  return bytes
}

export async function isCached(
  m: ModelDescriptor,
  deps: CacheDeps,
): Promise<boolean> {
  const cache = await deps.caches.open(CACHE_NAME)
  const hit = await cache.match(keyFor(m.sha256))
  return !!hit && hit.headers.get('x-sha256') === m.sha256
}

export type Progress = (loaded: number, total: number) => void

async function readBody(
  res: Response,
  total: number,
  onProgress: Progress | undefined,
  signal?: AbortSignal,
) {
  const out = new Uint8Array(total)
  let loaded = 0
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer())
    if (all.length !== total)
      throw new ModelError('size', 'the model download has the wrong size')
    return all
  }
  const reader = res.body.getReader()
  for (;;) {
    if (signal?.aborted) throw new ModelError('aborted', 'download cancelled')
    const { done, value } = await reader.read()
    if (done) break
    if (loaded + value.length > total) {
      void reader.cancel()
      throw new ModelError(
        'size',
        'the model download is larger than announced',
      )
    }
    out.set(value, loaded)
    loaded += value.length
    onProgress?.(loaded, total)
  }
  if (loaded !== total)
    throw new ModelError('size', 'the model download is incomplete')
  return out
}

/**
 * Download, verify, cache and return the model bytes. Retries are the caller's business (the prompt offers a
 * second attempt); each attempt starts from zero because a partial body is never kept.
 */
export async function downloadModel(
  m: ModelDescriptor,
  deps: CacheDeps,
  opts: { onProgress?: Progress; signal?: AbortSignal } = {},
): Promise<ArrayBuffer> {
  requireHttps(m.url)
  let res: Response
  try {
    res = await deps.fetch(m.url, {
      signal: opts.signal,
      credentials: 'omit',
      redirect: 'error',
    })
  } catch (err) {
    if (opts.signal?.aborted)
      throw new ModelError('aborted', 'download cancelled')
    throw new ModelError('network', String((err as Error)?.message ?? err))
  }
  if (!res.ok) throw new ModelError('http', `model host answered ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? m.sizeBytes)
  if (Number.isFinite(declared) && declared > m.sizeBytes)
    throw new ModelError('size', 'the model is larger than announced')
  let body: Uint8Array
  try {
    body = await readBody(res, m.sizeBytes, opts.onProgress, opts.signal)
  } catch (err) {
    if (err instanceof ModelError) throw err
    throw new ModelError(
      opts.signal?.aborted ? 'aborted' : 'network',
      String((err as Error)?.message ?? err),
    )
  }
  const bytes = body.buffer as ArrayBuffer
  if ((await deps.sha256(bytes)) !== m.sha256)
    throw new ModelError(
      'hash',
      'the downloaded model does not match its checksum',
    )
  try {
    const cache = await deps.caches.open(CACHE_NAME)
    await cache.put(
      keyFor(m.sha256),
      new Response(bytes.slice(0), {
        headers: {
          'content-type': 'application/octet-stream',
          'x-sha256': m.sha256,
          'x-size': String(m.sizeBytes),
        },
      }),
    )
    await evictExcept(deps, m.sha256) // only now that the new one is safely stored
  } catch (err) {
    if ((err as Error)?.name === 'QuotaExceededError')
      throw new ModelError('quota', 'not enough storage space for the model')
    // A cache that cannot be written still lets this session run; it just downloads again next time.
  }
  return bytes
}

async function evictExcept(deps: CacheDeps, keep: string) {
  const cache = await deps.caches.open(CACHE_NAME)
  for (const req of await cache.keys())
    if (!new URL(req.url, 'https://invalid.example').pathname.includes(keep))
      await cache.delete(req)
}

/** "Remove model": everything this app stored for the engine. */
export async function removeModels(deps: CacheDeps): Promise<void> {
  await deps.caches.delete(CACHE_NAME)
}

/** The label map for `m`: cache first, else fetched (small, https only), validated, cached. */
export async function loadLabelMap(
  m: ModelDescriptor,
  deps: CacheDeps,
): Promise<LabelMap> {
  const cache = await deps.caches.open(CACHE_NAME)
  const key = labelKeyFor(m.sha256, m.labelMapVersion)
  const hit = await cache.match(key)
  let json: unknown = hit ? await hit.json().catch(() => null) : null
  if (!json) {
    const url = labelMapUrl(m.url)
    requireHttps(url)
    let res: Response
    try {
      res = await deps.fetch(url, { credentials: 'omit', redirect: 'error' })
    } catch (err) {
      throw new ModelError('network', String((err as Error)?.message ?? err))
    }
    if (!res.ok)
      throw new ModelError('http', `label map host answered ${res.status}`)
    json = await res.json().catch(() => null)
    try {
      parseLabelMap(json) // never cache what we cannot use
    } catch (err) {
      throw new ModelError('label_map', (err as LabelMapError).message)
    }
    await cache
      .put(
        key,
        new Response(JSON.stringify(json), {
          headers: { 'content-type': 'application/json' },
        }),
      )
      .catch(() => undefined)
  }
  let map: LabelMap
  try {
    map = parseLabelMap(json)
  } catch (err) {
    await cache.delete(key)
    throw new ModelError('label_map', (err as LabelMapError).message)
  }
  if (map.version !== m.labelMapVersion) {
    await cache.delete(key)
    throw new ModelError(
      'label_map',
      'the label map is not the version this model needs',
    )
  }
  return map
}
