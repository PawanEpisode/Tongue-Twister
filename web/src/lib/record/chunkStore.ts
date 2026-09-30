/**
 * Crash-safe storage for takes: every 1 s chunk is written to IndexedDB as it is recorded, so a crash,
 * reload or dead battery loses at most the last second (PRD 04 §8). Falls back to memory when IndexedDB
 * is blocked (private windows), which still lets the take be reviewed and downloaded, just not recovered.
 *
 * Chunks are stored as ArrayBuffers: Blobs in IndexedDB are unreliable on older Safari.
 */
import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'
import type {
  CaptureSource,
  RecordingEndedReason,
  RecordingLayout,
} from '../api'

export const GUEST_RETENTION_MS = 24 * 60 * 60 * 1000

/** What the review page needs to rebuild captions and markers for a recovered take. */
export type StoredAnalysis = {
  transcript: string
  longPauseMs: number
  /** First time each displayed word was said correctly, ms into the take; -1 = never. */
  hitTimes: number[]
  /** Read-along schedule (word start times) when pacing was on. */
  paceStarts: number[] | null
}

export type StoredMeta = {
  id: string
  /** Supabase user id; null = guest. */
  owner: string | null
  twister: string
  twisterText: string
  layout: RecordingLayout
  mime: string
  startedAt: number
  updatedAt: number
  /** 'recording' on disk after a crash = an orphan to recover. */
  status: 'recording' | 'stopped' | 'saved'
  durationMs: number
  width: number
  height: number
  fps: number
  hasCamera: boolean
  hasScreen: boolean
  hasMic: boolean
  hasSystemAudio: boolean
  captureSource: CaptureSource
  endedReason: RecordingEndedReason | null
  recovered: boolean
  /** Guests: 24 h retention. null = keep until saved or discarded. */
  expiresAt: number | null
  attemptId: number | null
  analysis: StoredAnalysis | null
  layoutSettings: Record<string, unknown>
}

export type Assembled = { blob: Blob; durationMs: number; chunks: number }

export type ChunkStore = {
  readonly persistent: boolean
  create: (meta: StoredMeta) => Promise<void>
  append: (
    id: string,
    seq: number,
    data: Blob,
    elapsedMs: number,
  ) => Promise<void>
  update: (id: string, patch: Partial<StoredMeta>) => Promise<void>
  get: (id: string) => Promise<StoredMeta | undefined>
  list: () => Promise<StoredMeta[]>
  assemble: (id: string) => Promise<Assembled | null>
  remove: (id: string) => Promise<void>
  /** Delete takes past their retention; returns their ids. */
  purgeExpired: (now: number) => Promise<string[]>
}

export const isRecoverable = (
  m: StoredMeta,
  owner: string | null,
  now: number,
): boolean =>
  m.status !== 'saved' &&
  (m.expiresAt === null || m.expiresAt > now) &&
  (m.owner === null || m.owner === owner)

// ─── IndexedDB ──────────────────────────────────────────────────────────────

type ChunkRow = { id: string; seq: number; buf: ArrayBuffer; elapsedMs: number }
interface RecordDB extends DBSchema {
  meta: { key: string; value: StoredMeta }
  chunks: { key: [string, number]; value: ChunkRow }
}
const DB_NAME = 'twister-record'

export function createIdbChunkStore(name = DB_NAME): ChunkStore {
  let dbPromise: Promise<IDBPDatabase<RecordDB>> | null = null
  const db = () => {
    dbPromise ??= openDB<RecordDB>(name, 1, {
      upgrade(d) {
        d.createObjectStore('meta', { keyPath: 'id' })
        d.createObjectStore('chunks', { keyPath: ['id', 'seq'] })
      },
    })
    return dbPromise
  }
  const rangeOf = (id: string) =>
    IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])

  const store: ChunkStore = {
    persistent: true,
    async create(meta) {
      await (await db()).put('meta', meta)
    },
    async append(id, seq, data, elapsedMs) {
      const buf = await data.arrayBuffer()
      await (await db()).put('chunks', { id, seq, buf, elapsedMs })
    },
    async update(id, patch) {
      const d = await db()
      const tx = d.transaction('meta', 'readwrite')
      const cur = await tx.store.get(id)
      if (cur) await tx.store.put({ ...cur, ...patch, updatedAt: Date.now() })
      await tx.done
    },
    async get(id) {
      return (await db()).get('meta', id)
    },
    async list() {
      return (await db()).getAll('meta')
    },
    async assemble(id) {
      const d = await db()
      const meta = await d.get('meta', id)
      if (!meta) return null
      const rows = await d.getAll('chunks', rangeOf(id))
      if (!rows.length) return null
      return {
        blob: new Blob(
          rows.map((r) => r.buf),
          { type: meta.mime },
        ),
        durationMs: Math.max(meta.durationMs, rows[rows.length - 1].elapsedMs),
        chunks: rows.length,
      }
    },
    async remove(id) {
      const d = await db()
      const tx = d.transaction(['meta', 'chunks'], 'readwrite')
      await Promise.all([
        tx.objectStore('meta').delete(id),
        tx.objectStore('chunks').delete(rangeOf(id)),
        tx.done,
      ])
    },
    async purgeExpired(now) {
      const gone = (await store.list())
        .filter((m) => m.expiresAt !== null && m.expiresAt <= now)
        .map((m) => m.id)
      for (const id of gone) await store.remove(id)
      return gone
    },
  }
  return store
}

// ─── Memory fallback ────────────────────────────────────────────────────────

export function createMemoryChunkStore(): ChunkStore {
  const metas = new Map<string, StoredMeta>()
  const chunks = new Map<
    string,
    { data: Blob; seq: number; elapsedMs: number }[]
  >()
  return {
    persistent: false,
    async create(meta) {
      metas.set(meta.id, meta)
      chunks.set(meta.id, [])
    },
    async append(id, seq, data, elapsedMs) {
      chunks.get(id)?.push({ data, seq, elapsedMs })
    },
    async update(id, patch) {
      const cur = metas.get(id)
      if (cur) metas.set(id, { ...cur, ...patch, updatedAt: Date.now() })
    },
    async get(id) {
      return metas.get(id)
    },
    async list() {
      return [...metas.values()]
    },
    async assemble(id) {
      const meta = metas.get(id)
      const rows = chunks.get(id)
      if (!meta || !rows?.length) return null
      const sorted = [...rows].sort((a, b) => a.seq - b.seq)
      return {
        blob: new Blob(
          sorted.map((r) => r.data),
          { type: meta.mime },
        ),
        durationMs: Math.max(
          meta.durationMs,
          sorted[sorted.length - 1].elapsedMs,
        ),
        chunks: sorted.length,
      }
    },
    async remove(id) {
      metas.delete(id)
      chunks.delete(id)
    },
    async purgeExpired(now) {
      const gone = [...metas.values()]
        .filter((m) => m.expiresAt !== null && m.expiresAt <= now)
        .map((m) => m.id)
      gone.forEach((id) => {
        metas.delete(id)
        chunks.delete(id)
      })
      return gone
    },
  }
}

let shared: Promise<ChunkStore> | null = null

/** The app-wide store: IndexedDB when it works (probed once), memory otherwise. Never call at import time. */
export function openChunkStore(): Promise<ChunkStore> {
  shared ??= (async () => {
    if (typeof indexedDB === 'undefined') return createMemoryChunkStore()
    try {
      const store = createIdbChunkStore()
      await store.list() // fails fast in browsers that block storage
      return store
    } catch {
      return createMemoryChunkStore()
    }
  })()
  return shared
}

export const newMeta = (
  init: Pick<
    StoredMeta,
    | 'id'
    | 'owner'
    | 'twister'
    | 'twisterText'
    | 'layout'
    | 'mime'
    | 'width'
    | 'height'
    | 'fps'
    | 'hasCamera'
    | 'hasScreen'
    | 'hasMic'
    | 'hasSystemAudio'
    | 'captureSource'
    | 'layoutSettings'
  >,
  now = Date.now(),
): StoredMeta => ({
  ...init,
  startedAt: now,
  updatedAt: now,
  status: 'recording',
  durationMs: 0,
  endedReason: null,
  recovered: false,
  expiresAt: init.owner === null ? now + GUEST_RETENTION_MS : null,
  attemptId: null,
  analysis: null,
})
