/// <reference lib="webworker" />
/**
 * Inference worker: the only place onnxruntime-web is loaded, so the UI thread never blocks and the ~50 KB
 * JS + 14 MB wasm only cost anything when a user turns Accurate mode on. The WASM binary is served from our own
 * origin (Vite emits it as a hashed asset), which keeps the CSP closed to third-party script hosts.
 */
import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import { OrtRunner, RunnerError } from './runner'
import type { OrtModuleLike } from './runner'
import type { WorkerRequest, WorkerResponse } from './protocol'

let runner: OrtRunner | null = null
const scope = self as unknown as DedicatedWorkerGlobalScope

const reply = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  scope.postMessage(msg, transfer)

function codeFor(err: unknown, fallback: 'init_failed' | 'run_failed') {
  if (err instanceof RunnerError)
    return err.code === 'disposed' ? 'not_initialised' : err.code
  const text = String((err as Error)?.message ?? err)
  return /memory|alloc/i.test(text) ? ('out_of_memory' as const) : fallback
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  try {
    if (msg.type === 'init') {
      const started = performance.now()
      ort.env.wasm.wasmPaths = { wasm: wasmUrl }
      ort.env.wasm.numThreads = scope.crossOriginIsolated
        ? Math.max(1, msg.threads)
        : 1
      ort.env.wasm.proxy = false
      await runner?.dispose()
      runner = await OrtRunner.create(
        ort as unknown as OrtModuleLike,
        new Uint8Array(msg.bytes),
      )
      reply({
        type: 'ready',
        id: msg.id,
        loadMs: Math.round(performance.now() - started),
      })
    } else if (msg.type === 'run') {
      if (!runner)
        return reply({
          type: 'error',
          id: msg.id,
          code: 'not_initialised',
          message: 'no model loaded',
        })
      const out = await runner.run(msg.samples)
      reply({ type: 'result', id: msg.id, ...out }, [out.logits.buffer])
    } else {
      await runner?.dispose()
      runner = null
      reply({ type: 'disposed', id: msg.id })
    }
  } catch (err) {
    reply({
      type: 'error',
      id: msg.id,
      code: codeFor(err, msg.type === 'init' ? 'init_failed' : 'run_failed'),
      message: String((err as Error)?.message ?? err).slice(0, 200),
    })
  }
}
