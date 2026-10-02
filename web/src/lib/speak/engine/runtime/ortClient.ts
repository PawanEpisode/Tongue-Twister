/**
 * Main-thread handle on the inference worker: promise-per-request RPC, cancellation by terminating the worker
 * (the only way to stop a running WASM inference), and a hard teardown. The worker is injected so tests and
 * the calibration page can swap it.
 */
import type { WorkerErrorCode, WorkerRequest, WorkerResponse } from './protocol'

export interface WorkerLike {
  postMessage: (msg: WorkerRequest, transfer?: Transferable[]) => void
  terminate: () => void
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
}

export class EngineWorkerError extends Error {
  constructor(
    readonly code: WorkerErrorCode | 'aborted' | 'worker_crashed' | 'timeout',
    message: string,
  ) {
    super(message)
    this.name = 'EngineWorkerError'
  }
}

type Pending = {
  resolve: (r: WorkerResponse) => void
  reject: (e: EngineWorkerError) => void
  timer: ReturnType<typeof setTimeout> | null
}

export class OrtClient {
  private worker: WorkerLike | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(
    private readonly factory: () => WorkerLike,
    private readonly timeouts = { init: 120_000, run: 60_000 },
  ) {}

  private ensure(): WorkerLike {
    if (this.worker) return this.worker
    const w = this.factory()
    w.onmessage = (event) => {
      const entry = this.pending.get(event.data.id)
      if (!entry) return
      this.pending.delete(event.data.id)
      if (entry.timer) clearTimeout(entry.timer)
      if (event.data.type === 'error')
        entry.reject(new EngineWorkerError(event.data.code, event.data.message))
      else entry.resolve(event.data)
    }
    w.onerror = () =>
      this.crash(
        new EngineWorkerError('worker_crashed', 'inference worker crashed'),
      )
    this.worker = w
    return w
  }

  private crash(err: EngineWorkerError) {
    const entries = [...this.pending.values()]
    this.pending.clear()
    this.worker?.terminate()
    this.worker = null
    for (const e of entries) {
      if (e.timer) clearTimeout(e.timer)
      e.reject(err)
    }
  }

  private call(
    build: (id: number) => WorkerRequest,
    transfer: Transferable[],
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<WorkerResponse> {
    if (signal?.aborted)
      return Promise.reject(new EngineWorkerError('aborted', 'aborted'))
    const worker = this.ensure()
    const id = this.nextId++
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.crash(new EngineWorkerError('timeout', 'inference timed out')),
        timeoutMs,
      )
      this.pending.set(id, { resolve, reject, timer })
      signal?.addEventListener(
        'abort',
        () => this.crash(new EngineWorkerError('aborted', 'aborted')),
        { once: true },
      )
      worker.postMessage(build(id), transfer)
    })
  }

  /** Hands the model bytes to the worker (transferred, not copied) and waits for the session to be created. */
  async init(
    bytes: ArrayBuffer,
    threads: number,
    signal?: AbortSignal,
  ): Promise<number> {
    const res = await this.call(
      (id) => ({ type: 'init', id, bytes, threads }),
      [bytes],
      this.timeouts.init,
      signal,
    )
    return res.type === 'ready' ? res.loadMs : 0
  }

  async run(samples: Float32Array, signal?: AbortSignal) {
    const copy = new Float32Array(samples) // the original stays usable (the WAV for a spot-check is built from it)
    const res = await this.call(
      (id) => ({ type: 'run', id, samples: copy }),
      [copy.buffer],
      this.timeouts.run,
      signal,
    )
    if (res.type !== 'result')
      throw new EngineWorkerError('run_failed', 'unexpected reply')
    return res
  }

  /** Free the model and stop the worker. Safe to call repeatedly. */
  dispose() {
    this.crash(new EngineWorkerError('aborted', 'disposed'))
  }
}
