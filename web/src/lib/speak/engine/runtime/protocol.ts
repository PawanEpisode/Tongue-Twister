/** Messages between the main thread and the inference worker. */
export type WorkerRequest =
  | { type: 'init'; id: number; bytes: ArrayBuffer; threads: number }
  | { type: 'run'; id: number; samples: Float32Array }
  | { type: 'dispose'; id: number }

export type WorkerErrorCode =
  | 'init_failed'
  | 'run_failed'
  | 'bad_output'
  | 'empty_input'
  | 'not_initialised'
  | 'out_of_memory'

export type WorkerResponse =
  | { type: 'ready'; id: number; loadMs: number }
  | {
      type: 'result'
      id: number
      logits: Float32Array
      frames: number
      vocab: number
      ms: number
    }
  | { type: 'disposed'; id: number }
  | { type: 'error'; id: number; code: WorkerErrorCode; message: string }
