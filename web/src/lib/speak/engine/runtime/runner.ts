/**
 * The inference core, independent of where it runs (Web Worker in the app, a fake in tests): normalise the
 * clip, run it through the ONNX session in overlapping windows, stitch the logits.
 * The model contract is tools/export_model: input `input_values` (batch, samples), output `logits`
 * (batch, frames, vocab), zero-mean unit-variance input at 16 kHz.
 */
import {
  CHUNK_SAMPLES,
  OVERLAP_SAMPLES,
  STRIDE,
  framesFor,
  planChunks,
  stitch,
} from './chunking'
import type { Part } from './chunking'

export type OrtTensorLike = { data: ArrayLike<number>; dims: readonly number[] }
export interface OrtSessionLike {
  run: (
    feeds: Record<string, unknown>,
  ) => Promise<Record<string, OrtTensorLike>>
  release?: () => Promise<void>
}
export interface OrtModuleLike {
  InferenceSession: {
    create: (
      bytes: Uint8Array,
      options: Record<string, unknown>,
    ) => Promise<OrtSessionLike>
  }
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown
}

export class RunnerError extends Error {
  constructor(
    readonly code: 'bad_output' | 'empty_input' | 'disposed',
    message: string,
  ) {
    super(message)
    this.name = 'RunnerError'
  }
}

/** Zero mean, unit variance over the whole clip (what the exported wav2vec2 expects). */
export function normalise(samples: Float32Array): Float32Array {
  const n = samples.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += samples[i]
  mean /= n || 1
  let variance = 0
  for (let i = 0; i < n; i++) variance += (samples[i] - mean) ** 2
  const std = Math.sqrt(variance / (n || 1))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = (samples[i] - mean) / (std + 1e-7)
  return out
}

export type RunResult = {
  logits: Float32Array
  frames: number
  vocab: number
  ms: number
}

export class OrtRunner {
  private disposed = false
  private constructor(
    private readonly ort: OrtModuleLike,
    private readonly session: OrtSessionLike,
  ) {}

  static async create(
    ort: OrtModuleLike,
    bytes: Uint8Array,
    options: Record<string, unknown> = {},
  ): Promise<OrtRunner> {
    const session = await ort.InferenceSession.create(bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
      ...options,
    })
    return new OrtRunner(ort, session)
  }

  async run(
    samples: Float32Array,
    now: () => number = () => performance.now(),
    window = { chunk: CHUNK_SAMPLES, overlap: OVERLAP_SAMPLES },
  ): Promise<RunResult> {
    if (this.disposed) throw new RunnerError('disposed', 'runner was disposed')
    if (samples.length < 400)
      throw new RunnerError('empty_input', 'clip too short for the model')
    const started = now()
    const input = normalise(samples)
    const parts: Part[] = []
    let vocab = 0
    for (const w of planChunks(input.length, window.chunk, window.overlap)) {
      const slice = input.subarray(w.start, w.end)
      const feeds = {
        input_values: new this.ort.Tensor('float32', slice, [1, slice.length]),
      }
      const out = await this.session.run(feeds)
      const logits = out.logits
      if (!logits || logits.dims.length !== 3 || logits.dims[0] !== 1)
        throw new RunnerError('bad_output', 'unexpected model output')
      const frames = logits.dims[1]
      vocab = logits.dims[2]
      const data =
        logits.data instanceof Float32Array
          ? logits.data
          : Float32Array.from(logits.data)
      if (frames !== framesFor(slice.length) || data.length !== frames * vocab)
        throw new RunnerError(
          'bad_output',
          'model output has the wrong number of frames',
        )
      if (!data.every(Number.isFinite))
        throw new RunnerError('bad_output', 'model output is not finite')
      parts.push({ startFrame: w.start / STRIDE, frames, logits: data })
    }
    const stitched = stitch(parts, vocab)
    return { ...stitched, vocab, ms: now() - started }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await this.session.release?.()
  }
}
