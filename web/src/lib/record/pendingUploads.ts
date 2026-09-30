/** Persisted upload jobs. Tiny and dependency-free so the root layout can check for leftovers without pulling in tus. */
import type { PersistedJob } from './uploadManager'

const KEY = 'twister.uploads.v1'

export function loadPersisted(): PersistedJob[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as PersistedJob[]) : []
  } catch {
    return []
  }
}

export function savePersisted(jobs: PersistedJob[]): void {
  try {
    if (jobs.length) window.localStorage.setItem(KEY, JSON.stringify(jobs))
    else window.localStorage.removeItem(KEY)
  } catch {
    /* quota / private mode: the job still runs, it just won't survive a reload */
  }
}

/** Whether a reload left uploads behind for this user. */
export const hasPendingUploads = (owner: string): boolean =>
  loadPersisted().some((j) => j.owner === owner)
