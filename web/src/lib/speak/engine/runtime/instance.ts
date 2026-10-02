/**
 * The one AccurateEngine of this tab, wired to the real browser (Worker, Cache Storage, localStorage, the API).
 * Loaded lazily by `useAccurateEngine`, so none of the engine ships in the first-load bundle.
 */
import { api } from '../../../api'
import { readEnv } from './deviceGate'
import { AccurateEngine } from './engine'
import { browserDeps } from './modelCache'
import { OrtClient } from './ortClient'
import type { WorkerLike } from './ortClient'

let instance: AccurateEngine | null = null

function storage() {
  try {
    return window.localStorage
  } catch {
    return null // blocked storage (some private modes): preferences just don't persist
  }
}

export function getAccurateEngine(): AccurateEngine {
  instance ??= new AccurateEngine({
    env: () => readEnv(),
    fetchManifest: () => api.engineManifest(),
    cache: browserDeps(),
    makeClient: () =>
      new OrtClient(
        () =>
          new Worker(new URL('./ort.worker.ts', import.meta.url), {
            type: 'module',
          }) as unknown as WorkerLike,
      ),
    storage: storage(),
  })
  return instance
}
