import { describe, expect, it } from 'vitest'
import { EngineWorkerError, OrtClient } from './ortClient'
import type { WorkerLike } from './ortClient'
import type { WorkerRequest, WorkerResponse } from './protocol'

function fakeWorker(
  handler: (req: WorkerRequest, reply: (r: WorkerResponse) => void) => void,
) {
  const w: WorkerLike & { terminated: number } = {
    terminated: 0,
    onmessage: null,
    onerror: null,
    postMessage(msg) {
      queueMicrotask(() =>
        handler(msg, (r) =>
          w.onmessage?.({ data: r } as MessageEvent<WorkerResponse>),
        ),
      )
    },
    terminate() {
      w.terminated++
    },
  }
  return w
}
const okHandler = (req: WorkerRequest, reply: (r: WorkerResponse) => void) => {
  if (req.type === 'init') reply({ type: 'ready', id: req.id, loadMs: 5 })
  else if (req.type === 'run')
    reply({
      type: 'result',
      id: req.id,
      logits: new Float32Array(6),
      frames: 2,
      vocab: 3,
      ms: 7,
    })
  else reply({ type: 'disposed', id: req.id })
}

describe('OrtClient', () => {
  it('initialises, runs, and leaves the caller its own samples', async () => {
    const w = fakeWorker(okHandler)
    const client = new OrtClient(() => w)
    expect(await client.init(new ArrayBuffer(8), 1)).toBe(5)
    const samples = new Float32Array([1, 2, 3])
    const out = await client.run(samples)
    expect(out.frames).toBe(2)
    expect(samples.length).toBe(3) // not detached by the transfer
  })
  it('turns worker errors into typed errors', async () => {
    const client = new OrtClient(() =>
      fakeWorker((req, reply) =>
        reply({
          type: 'error',
          id: req.id,
          code: 'out_of_memory',
          message: 'oom',
        }),
      ),
    )
    await expect(client.run(new Float32Array(10))).rejects.toMatchObject({
      code: 'out_of_memory',
    })
  })
  it('aborting terminates the worker, rejects and allows a fresh worker next time', async () => {
    const workers: ReturnType<typeof fakeWorker>[] = []
    const client = new OrtClient(() => {
      const w = fakeWorker((req, reply) => {
        if (workers.length > 1) okHandler(req, reply) // second worker answers; first never does
      })
      workers.push(w)
      return w
    })
    const ctl = new AbortController()
    const p = client.run(new Float32Array(10), ctl.signal)
    ctl.abort()
    await expect(p).rejects.toMatchObject({ code: 'aborted' })
    expect(workers[0].terminated).toBe(1)
    await expect(
      client.run(new Float32Array(10), ctl.signal),
    ).rejects.toMatchObject({ code: 'aborted' })
    const out = await client.run(new Float32Array(10))
    expect(out.ms).toBe(7)
    expect(workers).toHaveLength(2)
  })
  it('times out a hung inference and a crash rejects everything pending', async () => {
    const hung = new OrtClient(() => fakeWorker(() => undefined), {
      init: 20,
      run: 20,
    })
    await expect(hung.run(new Float32Array(10))).rejects.toMatchObject({
      code: 'timeout',
    })
    let worker!: ReturnType<typeof fakeWorker>
    const crashy = new OrtClient(() => (worker = fakeWorker(() => undefined)))
    const p = crashy.run(new Float32Array(10))
    worker.onerror?.({} as ErrorEvent)
    await expect(p).rejects.toBeInstanceOf(EngineWorkerError)
    await expect(p).rejects.toMatchObject({ code: 'worker_crashed' })
  })
  it('dispose is safe to repeat', async () => {
    const w = fakeWorker(okHandler)
    const client = new OrtClient(() => w)
    await client.init(new ArrayBuffer(1), 1)
    client.dispose()
    client.dispose()
    expect(w.terminated).toBe(1)
  })
})
