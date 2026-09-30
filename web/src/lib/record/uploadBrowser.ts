/** Browser wiring for the upload manager (tus-js-client, localStorage, IndexedDB). Loaded lazily. */
import type * as Tus from 'tus-js-client'
import { api } from '../api'
import { openChunkStore } from './chunkStore'
import { loadPersisted, savePersisted } from './pendingUploads'
import { takeFromStored } from './take'
import { createUploadManager } from './uploadManager'
import type { TusFactory, UploadManager } from './uploadManager'

async function sha256(blob: Blob): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await blob.arrayBuffer(),
    )
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}

let tusModule: typeof Tus | null = null

/** tus needs to be loaded before the first upload starts; the factory itself stays synchronous. */
const tusFactory: TusFactory = (blob, grant, h) => {
  const tus = tusModule
  if (!tus) throw new Error('tus not loaded')
  const upload = new tus.Upload(blob, {
    endpoint: grant.signed_url,
    // Supabase resumable uploads: bearer grant + object identity in the metadata.
    headers: { authorization: `Bearer ${grant.token}`, 'x-upsert': 'false' },
    metadata: {
      bucketName: grant.bucket,
      objectName: grant.path,
      contentType: blob.type || 'video/webm',
      cacheControl: '3600',
    },
    chunkSize: grant.chunk_size,
    retryDelays: [0, 1000, 3000, 5000, 10000],
    removeFingerprintOnSuccess: true,
    onProgress: h.onProgress,
    onSuccess: () => h.onSuccess(),
    onError: h.onError,
  })
  return {
    start: () => upload.start(),
    abort: () => upload.abort(true),
    async resumeIfPossible() {
      const previous = await upload.findPreviousUploads()
      const match = previous.find((p) => p.size === blob.size)
      if (match) upload.resumeFromPreviousUpload(match)
    },
  }
}

let manager: UploadManager | null = null
let ready: Promise<UploadManager> | null = null

const beforeUnload = (e: BeforeUnloadEvent) => {
  e.preventDefault()
  e.returnValue = '' // legacy browsers need the assignment to show the prompt
}

/** The app-wide upload manager. Async because tus-js-client is loaded on demand. */
export function getUploadManager(): Promise<UploadManager> {
  ready ??= (async () => {
    tusModule = await import('tus-js-client')
    manager = createUploadManager({
      createRecording: api.createRecording,
      completeRecording: api.completeRecording,
      tus: tusFactory,
      getBlob: async (id) => {
        const store = await openChunkStore()
        const [meta, assembled] = await Promise.all([
          store.get(id),
          store.assemble(id),
        ])
        if (!meta || !assembled) return null
        return (await takeFromStored(meta, assembled, false)).blob
      },
      onUploaded: async (id) => {
        const store = await openChunkStore()
        await store.remove(id)
      },
      load: loadPersisted,
      save: savePersisted,
      sha256,
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (h) => window.clearTimeout(h as number),
      now: () => Date.now(),
      guard: {
        on: () => window.addEventListener('beforeunload', beforeUnload),
        off: () => window.removeEventListener('beforeunload', beforeUnload),
      },
    })
    window.addEventListener('online', () => manager?.networkOnline())
    return manager
  })()
  return ready
}
