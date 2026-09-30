/** Building the cloud request from a take. Pure, so the API contract mapping is tested in one place. */
import { CONSENT_VERSION } from '../api'
import type { CreateRecordingBody } from '../api'
import type { Take } from './take'

export function buildCreateBody(
  take: Take,
  opts: { title: string; attemptId: number | null; sessionId?: string },
): CreateRecordingBody {
  return {
    client_recording_id: take.id,
    twister: take.twister,
    ...(opts.sessionId && { session_id: opts.sessionId }),
    ...(opts.attemptId != null && { attempt: opts.attemptId }),
    layout: take.layout,
    layout_settings: take.layoutSettings,
    has_camera: take.hasCamera,
    has_screen: take.hasScreen,
    has_mic: take.hasMic,
    has_system_audio: take.hasSystemAudio,
    capture_source: take.captureSource,
    duration_ms: Math.round(take.durationMs),
    width: take.width,
    height: take.height,
    fps: take.fps,
    mime_type: take.mime || take.blob.type || 'video/webm',
    size_bytes: take.blob.size,
    title: opts.title.trim().slice(0, 80) || 'Recording',
    recovered: take.recovered,
    ended_reason: take.endedReason,
    consent: { recording_upload: CONSENT_VERSION },
  }
}

/** JPEG data URLs the API accepts are ≤ 200 KB; this is the decoded size of a base64 payload. */
export const THUMBNAIL_MAX_BYTES = 200 * 1024
export const base64Bytes = (dataUrl: string): number => {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return (
    Math.floor((b64.length * 3) / 4) -
    (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0)
  )
}
