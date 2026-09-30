/**
 * Record-mode events (PRD 04 §14). There is no analytics provider in the app yet, so events go to a
 * replaceable sink that does nothing by default; the names and payloads are typed so wiring one later
 * is a one-line `setTelemetrySink`.
 */
import type { RecordErrorClass } from './errors'
import type { RecordingEndedReason, RecordingLayout } from '../api'

export type TelemetryEvents = {
  record_setup_open: Record<string, never>
  record_permission: {
    kind: 'camera' | 'microphone' | 'screen'
    result: 'granted' | 'denied' | 'unavailable' | 'busy' | 'error'
  }
  record_start: {
    layout: RecordingLayout
    res: string
    fps: number
    mime: string
  }
  record_pause: {
    reason: 'user' | 'tab_hidden' | 'device_lost' | 'screen_stopped'
  }
  record_resume: Record<string, never>
  record_stop: {
    duration_ms: number
    size_bytes: number
    reason: Extract<
      RecordingEndedReason,
      'user' | 'limit' | 'error' | 'device' | 'tab_hidden'
    >
  }
  record_recover: Record<string, never>
  record_download: { ext: string }
  record_save_cloud: { size: number; ms: number }
  record_share_create: { expires_in: string }
  record_error: { class: RecordErrorClass }
}
export type TelemetryName = keyof TelemetryEvents
export type TelemetrySink = <TName extends TelemetryName>(
  name: TName,
  props: TelemetryEvents[TName],
) => void

let sink: TelemetrySink = () => undefined

export function setTelemetrySink(next: TelemetrySink): void {
  sink = next
}

export function track<TName extends TelemetryName>(
  name: TName,
  props: TelemetryEvents[TName],
): void {
  try {
    sink(name, props)
  } catch {
    /* analytics must never break recording */
  }
}
