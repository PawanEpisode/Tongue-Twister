/** Mistake markers on the scrub bar (PRD 04 §5): red for missed/wrong words, amber for close ones. Pure. */
import type { RecordingWord, WordStatus } from '../api'
import type { WordTiming } from './timings'

export type MarkerSeverity = 'miss' | 'near'
export type Marker = {
  ms: number
  /** 0–1 along the take, for positioning. */
  at: number
  word: string
  severity: MarkerSeverity
  label: string
}

const SEVERITY: Partial<Record<WordStatus, MarkerSeverity>> = {
  wrong: 'miss',
  missed: 'miss',
  near: 'near',
}
const LABEL: Record<MarkerSeverity, string> = { miss: 'missed', near: 'close' }

function marker(
  ms: number,
  word: string,
  status: WordStatus | null,
  durationMs: number,
): Marker | null {
  const severity = status ? SEVERITY[status] : undefined
  if (!severity || durationMs <= 0) return null
  const clamped = Math.min(durationMs, Math.max(0, ms))
  return {
    ms: clamped,
    at: clamped / durationMs,
    word,
    severity,
    label: `${word} — ${LABEL[severity]}`,
  }
}

/** From a local score: one status per displayed word, one timing per displayed word. */
export function buildMarkers(
  timings: readonly WordTiming[],
  statuses: readonly (WordStatus | null)[],
  durationMs: number,
): Marker[] {
  return timings
    .map((t) =>
      marker(t.startMs, t.word, statuses[t.index] ?? null, durationMs),
    )
    .filter((m): m is Marker => m !== null)
}

/** From the API's `words[]` (server-side timings) for saved recordings. */
export function markersFromApi(
  words: readonly RecordingWord[],
  durationMs: number,
): Marker[] {
  return words
    .map((w) =>
      w.start_ms == null
        ? null
        : marker(w.start_ms, w.target, w.status, durationMs),
    )
    .filter((m): m is Marker => m !== null)
}

/** Jump target for "next mistake": the first marker after `ms` (wraps to none). */
export const nextMarker = (
  markers: readonly Marker[],
  ms: number,
): Marker | null => markers.find((m) => m.ms > ms + 250) ?? null
