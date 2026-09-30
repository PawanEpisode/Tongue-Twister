/** A finished recording as the review page and uploader see it, plus rebuilding one from stored chunks. */
import type {
  CaptureSource,
  RecordingEndedReason,
  RecordingLayout,
} from '../api'
import type { Assembled, StoredAnalysis, StoredMeta } from './chunkStore'
import { extensionFor } from './mime'
import { fixWebmDuration } from './webmDuration'

export type Take = {
  /** Also the `client_recording_id` when saved to the cloud, and the chunk-store key. */
  id: string
  blob: Blob
  durationMs: number
  mime: string
  sizeBytes: number
  width: number
  height: number
  fps: number
  layout: RecordingLayout
  twister: string
  twisterText: string
  hasCamera: boolean
  hasScreen: boolean
  hasMic: boolean
  hasSystemAudio: boolean
  captureSource: CaptureSource
  endedReason: RecordingEndedReason
  recovered: boolean
  startedAt: number
  attemptId: number | null
  analysis: StoredAnalysis | null
  layoutSettings: Record<string, unknown>
}

/** Rebuild a Take from chunks left on disk (recovery, or a pending upload after a reload). */
export async function takeFromStored(
  meta: StoredMeta,
  assembled: Assembled,
  recovered: boolean,
): Promise<Take> {
  const durationMs = Math.max(assembled.durationMs, meta.durationMs)
  const blob = await fixWebmDuration(assembled.blob, durationMs)
  return {
    id: meta.id,
    blob,
    durationMs,
    mime: meta.mime,
    sizeBytes: blob.size,
    width: meta.width,
    height: meta.height,
    fps: meta.fps,
    layout: meta.layout,
    twister: meta.twister,
    twisterText: meta.twisterText,
    hasCamera: meta.hasCamera,
    hasScreen: meta.hasScreen,
    hasMic: meta.hasMic,
    hasSystemAudio: meta.hasSystemAudio,
    captureSource: meta.captureSource,
    endedReason: meta.endedReason ?? 'error',
    recovered: recovered || meta.recovered,
    startedAt: meta.startedAt,
    attemptId: meta.attemptId,
    analysis: meta.analysis,
    layoutSettings: meta.layoutSettings,
  }
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
/** "29 Sep" — fixed abbreviations, so the result does not depend on the browser's locale data. */
const shortDay = (when: number): string => {
  const d = new Date(when)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** "fuzzy-wuzzy-29-sep.webm" — safe for every filesystem. */
export function downloadName(
  take: Pick<Take, 'twister' | 'mime' | 'startedAt'>,
): string {
  const day = shortDay(take.startedAt).replace(' ', '-').toLowerCase()
  const slug = take.twister.replace(/[^a-z0-9-]+/gi, '-').slice(0, 40) || 'take'
  return `${slug}-${day}.${extensionFor(take.mime)}`
}

/** Default title from the twister's slug, e.g. "Fuzzy Wuzzy — 29 Sep". */
export function defaultTitle(slug: string, when: number): string {
  const name = slug
    .split('-')
    .filter(Boolean)
    .slice(0, 4)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
  return `${name || 'Recording'} — ${shortDay(when)}`.slice(0, 80)
}
