/**
 * Cloud upload of a finished take: create the recording (quota, consent and age are checked by the API),
 * send the bytes with a resumable TUS upload, then `complete`. Survives reloads (jobs are persisted and the
 * bytes stay in IndexedDB until the upload succeeds), retries with back-off, and never loses the local copy.
 * All I/O is injected, so the retry and resume logic is tested with fakes.
 */
import type {
  CreateRecordingBody,
  CreateRecordingResult,
  UploadInfo,
  RecordingSummary,
} from '../api'
import { classify, errorOf } from './errors'
import type { RecordError } from './errors'
import { track } from './telemetry'

export type UploadStatus =
  'queued' | 'creating' | 'uploading' | 'completing' | 'done' | 'failed'

export type UploadJob = {
  /** The take id = `client_recording_id`. */
  id: string
  owner: string
  title: string
  status: UploadStatus
  /** 0–1 */
  progress: number
  bytesTotal: number
  error: RecordError | null
  recordingId: string | null
  /** Auto-retries used so far. */
  attempts: number
  /** A retryable failure is waiting for the network / a retry. */
  waiting: boolean
}

export type PersistedJob = {
  id: string
  owner: string
  body: CreateRecordingBody
  thumbnail: string | null
  recordingId: string | null
}

export type TusHandlers = {
  onProgress: (sent: number, total: number) => void
  onSuccess: () => void
  onError: (err: unknown) => void
}
export type TusLike = {
  start: () => void
  abort: () => Promise<void>
  /** Picks up a previous, unfinished upload of the same file, if one is stored. */
  resumeIfPossible: () => Promise<void>
}
export type TusFactory = (
  blob: Blob,
  upload: UploadInfo,
  handlers: TusHandlers,
) => TusLike

export type UploadDeps = {
  createRecording: (body: CreateRecordingBody) => Promise<CreateRecordingResult>
  completeRecording: (
    id: string,
    body: {
      size_bytes: number
      checksum_sha256?: string
      thumbnail?: string | null
    },
  ) => Promise<RecordingSummary>
  tus: TusFactory
  /** The finished bytes for a job (from the chunk store, or memory). */
  getBlob: (id: string) => Promise<Blob | null>
  /** Called once the cloud has the file: the local chunks can go. */
  onUploaded: (id: string) => Promise<void>
  load: () => PersistedJob[]
  save: (jobs: PersistedJob[]) => void
  sha256: (blob: Blob) => Promise<string | null>
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  now: () => number
  /** "Uploading… don't close" while work is in flight. */
  guard: { on: () => void; off: () => void }
}

/** Auto-retry delays; after the last one the job waits for the "Retry upload" chip. */
export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const
const MAX_CHECKSUM_BYTES = 64 * 1024 * 1024
const ACTIVE: readonly UploadStatus[] = [
  'queued',
  'creating',
  'uploading',
  'completing',
]

/** Errors that no retry will fix (quota, consent, age, size, type). */
const PERMANENT_CLASSES = new Set<RecordError['class']>([
  'quota_exceeded',
  'consent_required',
  'age_required',
  'minor_not_allowed',
  'too_large',
  'unsupported_media_type',
])

export type UploadManager = {
  enqueue: (input: {
    body: CreateRecordingBody
    owner: string
    thumbnail?: string | null
    /** Bytes already in memory (the review page's blob). Otherwise read from the store. */
    blob?: Blob
  }) => void
  /** Manual retry (the chip), also after "consent granted" or "space freed". */
  retry: (id: string) => void
  /** Give up on a job; the local copy is untouched. */
  cancel: (id: string) => void
  /** Restart every unfinished job of this user after a reload. */
  resumePending: (owner: string) => void
  /** The network came back: retry jobs that were waiting on it. */
  networkOnline: () => void
  subscribe: (fn: () => void) => () => void
  getSnapshot: () => readonly UploadJob[]
  has: (id: string) => boolean
}

export function createUploadManager(deps: UploadDeps): UploadManager {
  let jobs: UploadJob[] = []
  const persisted = new Map<string, PersistedJob>()
  const blobs = new Map<string, Blob>()
  const tuses = new Map<string, TusLike>()
  const timers = new Map<string, unknown>()
  const started = new Map<string, number>()
  const listeners = new Set<() => void>()
  const running = new Set<string>()

  const emit = () => {
    jobs = [...jobs] // new array identity for useSyncExternalStore
    listeners.forEach((fn) => fn())
    const active = jobs.some((j) => ACTIVE.includes(j.status) || j.waiting)
    if (active) deps.guard.on()
    else deps.guard.off()
  }
  const patch = (id: string, p: Partial<UploadJob>) => {
    jobs = jobs.map((j) => (j.id === id ? { ...j, ...p } : j))
    emit()
  }
  const find = (id: string) => jobs.find((j) => j.id === id)
  const savePersisted = () => deps.save([...persisted.values()])

  const fail = (id: string, err: unknown) => {
    const error = classify(err)
    track('record_error', { class: error.class })
    const job = find(id)
    if (!job) return
    const permanent = PERMANENT_CLASSES.has(error.class)
    if (!permanent && job.attempts < RETRY_DELAYS_MS.length) {
      const delay = RETRY_DELAYS_MS[job.attempts]
      patch(id, {
        status: 'queued',
        error,
        attempts: job.attempts + 1,
        waiting: true,
      })
      timers.set(
        id,
        deps.setTimeout(() => {
          timers.delete(id)
          void run(id)
        }, delay),
      )
      return
    }
    patch(id, { status: 'failed', error, waiting: false })
  }

  async function run(id: string): Promise<void> {
    if (running.has(id)) return
    running.add(id)
    try {
      const job = find(id)
      const saved = persisted.get(id)
      if (!job || !saved) return
      patch(id, { status: 'creating', waiting: false })

      // Replaying create with the same client id returns the original recording and a fresh upload grant.
      const created = await deps.createRecording(saved.body)
      saved.recordingId = created.recording.id
      savePersisted()
      patch(id, { recordingId: created.recording.id })

      const blob = blobs.get(id) ?? (await deps.getBlob(id))
      if (!blob) {
        patch(id, {
          status: 'failed',
          error: {
            ...errorOf('upload_failed'),
            title: 'The local copy is gone',
            message: 'We can’t find this recording on this device any more.',
            retryable: false,
          },
        })
        return
      }
      const grant = created.upload
      if (grant) {
        patch(id, { status: 'uploading', progress: 0 })
        await new Promise<void>((resolve, reject) => {
          const upload = deps.tus(blob, grant, {
            onProgress: (sent, total) =>
              patch(id, {
                progress: total > 0 ? Math.min(1, sent / total) : 0,
              }),
            onSuccess: resolve,
            onError: reject,
          })
          tuses.set(id, upload)
          void upload.resumeIfPossible().then(
            () => upload.start(),
            () => upload.start(),
          )
        })
        tuses.delete(id)
      }

      patch(id, { status: 'completing', progress: 1 })
      const checksum =
        blob.size <= MAX_CHECKSUM_BYTES ? await deps.sha256(blob) : null
      await deps.completeRecording(created.recording.id, {
        size_bytes: blob.size,
        ...(checksum ? { checksum_sha256: checksum } : {}),
        thumbnail: saved.thumbnail,
      })
      persisted.delete(id)
      savePersisted()
      blobs.delete(id)
      await deps.onUploaded(id).catch(() => undefined)
      track('record_save_cloud', {
        size: blob.size,
        ms: deps.now() - (started.get(id) ?? deps.now()),
      })
      patch(id, { status: 'done', error: null, attempts: 0 })
    } catch (err) {
      tuses.delete(id)
      // Each attempt replays `create`, which also refreshes an expired upload grant.
      fail(id, err)
    } finally {
      running.delete(id)
    }
  }

  const add = (p: PersistedJob, title: string, size: number, blob?: Blob) => {
    if (find(p.id) && find(p.id)?.status !== 'done') return
    persisted.set(p.id, p)
    if (blob) blobs.set(p.id, blob)
    savePersisted()
    started.set(p.id, deps.now())
    jobs = [
      ...jobs.filter((j) => j.id !== p.id),
      {
        id: p.id,
        owner: p.owner,
        title,
        status: 'queued',
        progress: 0,
        bytesTotal: size,
        error: null,
        recordingId: p.recordingId,
        attempts: 0,
        waiting: false,
      },
    ]
    emit()
    void run(p.id)
  }

  const retry = (id: string) => {
    const job = find(id)
    if (!job || running.has(id)) return
    const t = timers.get(id)
    if (t !== undefined) deps.clearTimeout(t)
    timers.delete(id)
    patch(id, { attempts: 0, error: null, status: 'queued', waiting: false })
    void run(id)
  }

  return {
    enqueue({ body, owner, thumbnail = null, blob }) {
      add(
        {
          id: body.client_recording_id,
          owner,
          body,
          thumbnail,
          recordingId: null,
        },
        body.title,
        body.size_bytes,
        blob,
      )
    },
    retry,
    cancel(id) {
      const t = timers.get(id)
      if (t !== undefined) deps.clearTimeout(t)
      timers.delete(id)
      void tuses.get(id)?.abort()
      tuses.delete(id)
      persisted.delete(id)
      blobs.delete(id)
      savePersisted()
      jobs = jobs.filter((j) => j.id !== id)
      emit()
    },
    resumePending(owner) {
      for (const p of deps.load()) {
        if (p.owner !== owner) continue
        add(p, p.body.title, p.body.size_bytes)
      }
    },
    networkOnline() {
      for (const j of jobs)
        if (
          j.waiting ||
          (j.status === 'failed' &&
            j.error &&
            !PERMANENT_CLASSES.has(j.error.class))
        )
          retry(j.id)
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getSnapshot: () => jobs,
    has: (id) => jobs.some((j) => j.id === id),
  }
}
