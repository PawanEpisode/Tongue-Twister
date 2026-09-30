/**
 * MediaRecorder wrapper: 1 s chunks handed to a sink (the chunk store), pause/resume, and a `stop()` that
 * resolves only after the last chunk has been written. Errors come out as taxonomy entries.
 */
import { classify, errorOf } from './errors'
import type { RecordError } from './errors'

export const TIMESLICE_MS = 1000

export type ChunkSink = (chunk: {
  data: Blob
  seq: number
  /** Active recording time (paused time excluded) when the chunk was produced. */
  elapsedMs: number
}) => Promise<void>

export type RecorderOptions = {
  stream: MediaStream
  /** '' = browser default. */
  mime: string
  videoBitsPerSecond: number
  audioBitsPerSecond: number
  sink: ChunkSink
  /** Active recording time in ms (the session stopwatch). */
  elapsed: () => number
  onError: (e: RecordError) => void
}

export type MediaRecorderCtor = new (
  stream: MediaStream,
  options?: MediaRecorderOptions,
) => MediaRecorder

export type RecorderHandle = {
  /** The container the browser really used (may differ from the requested `mime`). */
  readonly mimeType: string
  state: () => RecordingState
  start: () => void
  pause: () => void
  resume: () => void
  /** Resolves once the final chunk is written. Safe to call twice. */
  stop: () => Promise<void>
  /** Drop the recorder without waiting; used on teardown. */
  dispose: () => void
}

export function createRecorder(
  opts: RecorderOptions,
  Ctor: MediaRecorderCtor = MediaRecorder,
): RecorderHandle {
  const recorder = new Ctor(opts.stream, {
    ...(opts.mime ? { mimeType: opts.mime } : {}),
    videoBitsPerSecond: opts.videoBitsPerSecond,
    audioBitsPerSecond: opts.audioBitsPerSecond,
  })
  let seq = 0
  let writes: Promise<void> = Promise.resolve()
  let failed = false
  let stopped: Promise<void> | null = null

  const fail = (e: RecordError) => {
    if (failed) return
    failed = true
    opts.onError(e)
  }

  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return
    const chunk = { data: ev.data, seq: seq++, elapsedMs: opts.elapsed() }
    writes = writes.then(() =>
      opts.sink(chunk).catch((err: unknown) => fail(classify(err))),
    )
  }
  recorder.onerror = (ev) => {
    const inner = (ev as Event & { error?: unknown }).error
    fail(inner ? classify(inner) : errorOf('recorder_error'))
  }

  return {
    get mimeType() {
      return recorder.mimeType || opts.mime
    },
    state: () => recorder.state,
    start: () => recorder.start(TIMESLICE_MS),
    pause: () => {
      if (recorder.state === 'recording') recorder.pause()
    },
    resume: () => {
      if (recorder.state === 'paused') recorder.resume()
    },
    stop() {
      if (stopped) return stopped
      stopped = new Promise<void>((resolve) => {
        if (recorder.state === 'inactive') return resolve()
        recorder.onstop = () => resolve()
        try {
          recorder.stop() // fires a final dataavailable, then stop
        } catch {
          resolve()
        }
      }).then(() => writes)
      return stopped
    },
    dispose() {
      recorder.ondataavailable = null
      recorder.onerror = null
      recorder.onstop = null
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          /* already stopping */
        }
      }
    },
  }
}
