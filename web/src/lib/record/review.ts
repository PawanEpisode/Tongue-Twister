/** Pure rules for a saved recording that is still being prepared or analysed. */
import type {
  Analysis,
  AnalysisStatus,
  CaptionsSource,
  Playback,
  RecordingStatus,
} from '../api'
import type { Cue } from './captions'

type Pollable = { status: RecordingStatus; analysis?: Analysis }

/** A recording without an `analysis` block (older API) has simply not been analysed. */
export const analysisStatus = (r: { analysis?: Analysis }): AnalysisStatus =>
  r.analysis?.status ?? 'none'

export const POLL_FIRST_MS = 2000
export const POLL_MAX_MS = 15_000
export const POLL_MAX_COUNT = 60

/** True while the server is still working on the video or the analysis. */
export const isBusy = (r: Pollable): boolean =>
  r.status === 'uploaded' ||
  r.status === 'processing' ||
  analysisStatus(r) === 'queued' ||
  analysisStatus(r) === 'running'

/**
 * Milliseconds until the next refetch, or `false` to stop. Backs off 2 s → 15 s (×1.6 per poll) and gives
 * up after `POLL_MAX_COUNT` polls so a stuck job never polls forever.
 */
export function pollDelay(
  r: Pollable | undefined,
  polls: number,
): number | false {
  if (!r || !isBusy(r) || polls >= POLL_MAX_COUNT) return false
  return Math.min(POLL_MAX_MS, Math.round(POLL_FIRST_MS * 1.6 ** polls))
}

export type CaptionChoice =
  { kind: 'server'; url: string } | { kind: 'local' } | { kind: 'none' }

/**
 * Which captions to show: the worker's alignment VTT wins; otherwise the VTT built on this device from
 * the transcript; otherwise any server VTT; otherwise none.
 */
export function chooseCaptions(input: {
  captionsUrl: string | null | undefined
  captionsSource: CaptionsSource | null | undefined
  localCues: readonly Cue[] | null | undefined
}): CaptionChoice {
  const { captionsUrl: url } = input
  if (url && input.captionsSource === 'alignment')
    return { kind: 'server', url }
  if (input.localCues?.length) return { kind: 'local' }
  if (url) return { kind: 'server', url }
  return { kind: 'none' }
}

export type PlaybackState = {
  status: RecordingStatus
  playback: Playback | null
}

/**
 * Polling returns a freshly signed URL every time; swapping it would restart the video. Keep the previous
 * one while it is still valid (by `marginMs`) and the recording has not changed stage (for example, the
 * transcoded file replacing the original).
 */
export function pickPlayback(
  prev: PlaybackState | null,
  next: PlaybackState,
  nowMs: number,
  marginMs = 60_000,
): Playback | null {
  const old = prev?.playback
  if (
    old &&
    next.playback &&
    prev?.status === next.status &&
    old.mime === next.playback.mime &&
    Date.parse(old.expires_at) - nowMs > marginMs
  )
    return old
  return next.playback
}
