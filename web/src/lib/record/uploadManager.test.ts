import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import type { CreateRecordingBody, CreateRecordingResult } from '../api'
import { RETRY_DELAYS_MS, createUploadManager } from './uploadManager'
import type { PersistedJob, TusHandlers, UploadDeps } from './uploadManager'

const body = (id = 'take-1'): CreateRecordingBody => ({
  client_recording_id: id,
  twister: 'peter-piper',
  layout: 'camera_text',
  has_camera: true,
  has_screen: false,
  has_mic: true,
  has_system_audio: false,
  capture_source: 'getUserMedia',
  duration_ms: 4000,
  width: 1280,
  height: 720,
  fps: 30,
  mime_type: 'video/webm',
  size_bytes: 1000,
  title: 'Peter Piper — 30 Sep',
  consent: { recording_upload: 'v1' },
})
const grant: CreateRecordingResult = {
  recording: {
    id: 'rec-1',
    title: 't',
    status: 'uploading',
    layout: 'camera_text',
    visibility: 'private',
    twister: 'peter-piper',
    duration_ms: 4000,
    size_bytes: 1000,
    mime_type: 'video/webm',
    created_at: '2026-09-30T00:00:00Z',
    expires_at: null,
  },
  upload: {
    provider: 'supabase',
    bucket: 'recordings',
    path: 'u/2026/09/a.webm',
    signed_url: 'https://x/upload/resumable',
    token: 'tok',
    expires_in: 3600,
    chunk_size: 6291456,
  },
  quota: { used_bytes: 1000, limit_bytes: 100000, count: 1, count_limit: 5 },
}

/** Everything is fake; timers are captured and fired by hand. */
function harness(over: Partial<UploadDeps> = {}) {
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = []
  let stored: PersistedJob[] = []
  const tusRuns: {
    handlers: TusHandlers
    started: boolean
    resumed: boolean
    aborted: boolean
  }[] = []
  const guard = { on: vi.fn(), off: vi.fn() }
  const deps: UploadDeps = {
    createRecording: vi.fn(async () => grant),
    completeRecording: vi.fn(async () => grant.recording),
    tus: (_blob, _grant, handlers) => {
      const run = { handlers, started: false, resumed: false, aborted: false }
      tusRuns.push(run)
      return {
        start: () => {
          run.started = true
        },
        abort: async () => {
          run.aborted = true
        },
        resumeIfPossible: async () => {
          run.resumed = true
        },
      }
    },
    getBlob: vi.fn(
      async () => new Blob([new Uint8Array(1000)], { type: 'video/webm' }),
    ),
    onUploaded: vi.fn(async () => undefined),
    load: () => stored,
    save: (jobs) => {
      stored = jobs
    },
    sha256: async () => 'abc123',
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cancelled: false }
      timers.push(t)
      return t
    },
    clearTimeout: (h) => {
      ;(h as { cancelled: boolean }).cancelled = true
    },
    now: () => 0,
    guard,
    ...over,
  }
  const manager = createUploadManager(deps)
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  return { deps, manager, timers, tusRuns, guard, flush, stored: () => stored }
}

describe('upload manager', () => {
  it('creates the recording, uploads with tus, then completes — and only then releases local data', async () => {
    const h = harness()
    h.manager.enqueue({
      body: body(),
      owner: 'u1',
      thumbnail: 'data:image/jpeg;base64,AA',
    })
    await h.flush()
    expect(h.deps.createRecording).toHaveBeenCalledOnce()
    expect(h.tusRuns).toHaveLength(1)
    expect(h.tusRuns[0].resumed).toBe(true)
    expect(h.tusRuns[0].started).toBe(true)
    expect(h.manager.getSnapshot()[0].status).toBe('uploading')
    expect(h.deps.completeRecording).not.toHaveBeenCalled()

    h.tusRuns[0].handlers.onProgress(500, 1000)
    expect(h.manager.getSnapshot()[0].progress).toBe(0.5)
    h.tusRuns[0].handlers.onSuccess()
    await h.flush()

    expect(h.deps.completeRecording).toHaveBeenCalledWith('rec-1', {
      size_bytes: 1000,
      checksum_sha256: 'abc123',
      thumbnail: 'data:image/jpeg;base64,AA',
    })
    expect(h.deps.onUploaded).toHaveBeenCalledWith('take-1')
    expect(h.manager.getSnapshot()[0].status).toBe('done')
    expect(h.stored()).toEqual([]) // nothing left to resume
  })

  it('sends the tus upload the grant from create', async () => {
    const seen: unknown[] = []
    const h = harness({
      tus: (blob, g, handlers) => {
        seen.push([blob.size, g.signed_url, g.token, g.chunk_size])
        void handlers
        return {
          start: () => undefined,
          abort: async () => undefined,
          resumeIfPossible: async () => undefined,
        }
      },
    })
    h.manager.enqueue({ body: body(), owner: 'u1' })
    await h.flush()
    expect(seen).toEqual([[1000, 'https://x/upload/resumable', 'tok', 6291456]])
  })

  it('retries a network failure with back-off and then succeeds', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(grant)
    const h = harness({ createRecording: create })
    h.manager.enqueue({ body: body(), owner: 'u1' })
    await h.flush()
    const job = h.manager.getSnapshot()[0]
    expect(job.status).toBe('queued')
    expect(job.waiting).toBe(true)
    expect(job.error?.class).toBe('network')
    expect(h.timers).toHaveLength(1)
    expect(h.timers[0].ms).toBe(RETRY_DELAYS_MS[0])
    h.timers[0].fn()
    await h.flush()
    expect(create).toHaveBeenCalledTimes(2)
    expect(h.manager.getSnapshot()[0].status).toBe('uploading')
  })

  it('a dropped tus upload is retried, and resumes from where it stopped', async () => {
    const h = harness()
    h.manager.enqueue({ body: body(), owner: 'u1' })
    await h.flush()
    h.tusRuns[0].handlers.onProgress(800, 1000)
    h.tusRuns[0].handlers.onError(new Error('tus: failed to upload chunk'))
    await h.flush()
    expect(h.manager.getSnapshot()[0].waiting).toBe(true)
    h.timers.at(-1)?.fn()
    await h.flush()
    // second attempt: a fresh tus upload that looks for the stored one to resume
    expect(h.tusRuns).toHaveLength(2)
    expect(h.tusRuns[1].resumed).toBe(true)
    expect(h.deps.createRecording).toHaveBeenCalledTimes(2) // replay create → fresh grant
  })

  it('gives up auto-retrying after the last delay and shows a retry chip; retry starts over', async () => {
    const create = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const h = harness({ createRecording: create })
    h.manager.enqueue({ body: body(), owner: 'u1' })
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      await h.flush()
      h.timers.at(-1)?.fn()
    }
    await h.flush()
    const job = h.manager.getSnapshot()[0]
    expect(job.status).toBe('failed')
    expect(job.waiting).toBe(false)
    expect(create).toHaveBeenCalledTimes(RETRY_DELAYS_MS.length + 1)

    create.mockResolvedValue(grant)
    h.manager.retry('take-1')
    await h.flush()
    expect(h.manager.getSnapshot()[0].status).toBe('uploading')
  })

  it.each([
    [402, 'quota_exceeded'],
    [403, 'consent_required'],
    [413, 'too_large'],
  ])('does not retry an API refusal (%i %s)', async (status, code) => {
    const create = vi.fn().mockRejectedValue(new ApiError(status, code))
    const h = harness({ createRecording: create })
    h.manager.enqueue({ body: body(), owner: 'u1' })
    await h.flush()
    const job = h.manager.getSnapshot()[0]
    expect(job.status).toBe('failed')
    expect(job.error?.class).toBe(code)
    expect(h.timers).toHaveLength(0)
    expect(create).toHaveBeenCalledOnce()
  })

  it('keeps the job persisted until it completes, so a reload can resume it', async () => {
    const h = harness()
    h.manager.enqueue({ body: body(), owner: 'u1', thumbnail: null })
    await h.flush()
    expect(h.stored()).toHaveLength(1)
    expect(h.stored()[0]).toMatchObject({
      id: 'take-1',
      owner: 'u1',
      recordingId: 'rec-1',
    })

    // "reload": a new manager over the same storage picks it up for the same user only
    const h2 = harness({ load: () => h.stored() })
    h2.manager.resumePending('someone-else')
    await h2.flush()
    expect(h2.manager.getSnapshot()).toHaveLength(0)
    h2.manager.resumePending('u1')
    await h2.flush()
    expect(h2.manager.getSnapshot()).toHaveLength(1)
    expect(h2.deps.getBlob).toHaveBeenCalledWith('take-1') // bytes come from the chunk store
    expect(h2.tusRuns[0].resumed).toBe(true)
  })

  it('fails clearly when the local copy is gone', async () => {
    const h = harness({ getBlob: async () => null })
    h.manager.enqueue({ body: body(), owner: 'u1' })
    await h.flush()
    const job = h.manager.getSnapshot()[0]
    expect(job.status).toBe('failed')
    expect(job.error?.title).toMatch(/local copy/i)
  })

  it('guards the page while work is in flight and lets go when idle', async () => {
    const h = harness()
    h.manager.enqueue({ body: body(), owner: 'u1' })
    await h.flush()
    expect(h.guard.on).toHaveBeenCalled()
    h.tusRuns[0].handlers.onSuccess()
    await h.flush()
    expect(h.guard.off).toHaveBeenCalled()
    expect(h.guard.off.mock.calls.length).toBeGreaterThan(0)
  })

  it('cancel aborts tus and forgets the job but never touches the local copy', async () => {
    const h = harness()
    h.manager.enqueue({ body: body(), owner: 'u1' })
    await h.flush()
    h.manager.cancel('take-1')
    expect(h.tusRuns[0].aborted).toBe(true)
    expect(h.manager.getSnapshot()).toHaveLength(0)
    expect(h.stored()).toEqual([])
    expect(h.deps.onUploaded).not.toHaveBeenCalled()
  })

  it('retries waiting jobs as soon as the network is back', async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(grant)
    const h = harness({ createRecording: create })
    h.manager.enqueue({ body: body(), owner: 'u1' })
    await h.flush()
    expect(h.manager.getSnapshot()[0].waiting).toBe(true)
    h.manager.networkOnline()
    await h.flush()
    expect(h.manager.getSnapshot()[0].status).toBe('uploading')
    expect(h.timers[0].cancelled).toBe(true)
  })

  it('ignores a duplicate enqueue of the same take', async () => {
    const h = harness()
    h.manager.enqueue({ body: body(), owner: 'u1' })
    h.manager.enqueue({ body: body(), owner: 'u1' })
    await h.flush()
    expect(h.deps.createRecording).toHaveBeenCalledOnce()
  })

  it('skips the checksum for very large files', async () => {
    const h = harness({
      getBlob: async () =>
        ({ size: 100 * 1024 * 1024, type: 'video/webm' }) as Blob,
    })
    h.manager.enqueue({ body: body(), owner: 'u1' })
    await h.flush()
    h.tusRuns[0].handlers.onSuccess()
    await h.flush()
    const call = (h.deps.completeRecording as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as Record<string, unknown>
    expect(call.checksum_sha256).toBeUndefined()
  })
})
