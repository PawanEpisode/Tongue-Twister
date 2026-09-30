/**
 * The one error taxonomy for Record mode (PRD 04 §8, 08 copy deck): any thrown value becomes a class
 * (for telemetry and branching), plain-language copy, and whether "try again" makes sense.
 */
import { ApiError } from '../api'

export type RecordErrorClass =
  | 'permission_denied'
  | 'device_busy'
  | 'device_missing'
  | 'overconstrained'
  | 'codec_unsupported'
  | 'recorder_error'
  | 'out_of_space'
  | 'device_lost'
  | 'screen_share_stopped'
  | 'unsupported'
  | 'screen_cancelled'
  | 'upload_failed'
  | 'network'
  | 'quota_exceeded'
  | 'consent_required'
  | 'age_required'
  | 'minor_not_allowed'
  | 'too_large'
  | 'unsupported_media_type'
  | 'processing_failed'
  | 'unknown'

export type RecordError = {
  class: RecordErrorClass
  title: string
  message: string
  /** A retry button is worthwhile (transient or fixable by the user). */
  retryable: boolean
}

const COPY: Record<RecordErrorClass, Omit<RecordError, 'class'>> = {
  permission_denied: {
    title: 'Camera or microphone is blocked',
    message:
      'Click the lock icon in the address bar → Site settings → Allow the camera and microphone, then try again. You can also record audio only, or use Read along.',
    retryable: true,
  },
  device_busy: {
    title: 'Another app is using it',
    message:
      'Another app (Zoom, Meet, …) is using your camera or microphone. Close it and try again.',
    retryable: true,
  },
  device_missing: {
    title: 'No camera or microphone found',
    message:
      'Plug one in and try again. Without a camera you can still record audio only.',
    retryable: true,
  },
  overconstrained: {
    title: 'That quality isn’t available',
    message: 'We switched to a lower resolution your camera supports.',
    retryable: true,
  },
  codec_unsupported: {
    title: 'This browser can’t record video',
    message:
      'Update your browser (Chrome, Edge, Firefox or Safari 14.1+) to record here, or use Speak & score.',
    retryable: false,
  },
  recorder_error: {
    title: 'The recorder stopped unexpectedly',
    message:
      'We kept everything captured so far. You can review it, or start a new take.',
    retryable: true,
  },
  out_of_space: {
    title: 'Out of storage space',
    message:
      'We stopped cleanly and kept what was saved. Free up space on this device to record more.',
    retryable: false,
  },
  device_lost: {
    title: 'Camera or microphone disconnected',
    message: 'Reconnect it to continue, or finish now and keep what you have.',
    retryable: true,
  },
  screen_share_stopped: {
    title: 'Screen sharing stopped',
    message: 'You stopped sharing. Continue with the camera only, or finish.',
    retryable: false,
  },
  screen_cancelled: {
    title: 'No screen chosen',
    message: 'Pick a window, tab or screen to share, or choose another layout.',
    retryable: true,
  },
  unsupported: {
    title: 'Not available in this browser',
    message: 'This layout needs a different browser or device.',
    retryable: false,
  },
  upload_failed: {
    title: 'Couldn’t upload right now',
    message:
      'Your recording is safe on this device — we’ll retry, or you can retry now.',
    retryable: true,
  },
  network: {
    title: 'You seem to be offline',
    message:
      'We can’t reach the server. Your recording is safe on this device.',
    retryable: true,
  },
  quota_exceeded: {
    title: 'Your saved recordings are full',
    message:
      'You’ve used all of your recording space. Delete one to make room — you can still download this take.',
    retryable: false,
  },
  consent_required: {
    title: 'We need your OK first',
    message: 'Confirm the saving terms to keep this recording in your account.',
    retryable: true,
  },
  age_required: {
    title: 'Tell us your age group',
    message: 'We need to know if you’re 13 or older before saving recordings.',
    retryable: true,
  },
  minor_not_allowed: {
    title: 'Saving isn’t available',
    message:
      'For your safety, recordings stay on this device. You can still download them.',
    retryable: false,
  },
  too_large: {
    title: 'That recording is too large',
    message:
      'Try a shorter take or a lower resolution. You can still download it.',
    retryable: false,
  },
  unsupported_media_type: {
    title: 'This format can’t be saved',
    message: 'Download the file instead — it stays on this device.',
    retryable: false,
  },
  processing_failed: {
    title: 'Processing failed',
    message: 'You can download the original recording.',
    retryable: true,
  },
  unknown: {
    title: 'Something went wrong',
    message: 'Please try again.',
    retryable: true,
  },
}

export const errorOf = (cls: RecordErrorClass): RecordError => ({
  class: cls,
  ...COPY[cls],
})

const API_CODES: Record<string, RecordErrorClass> = {
  quota_exceeded: 'quota_exceeded',
  consent_required: 'consent_required',
  age_required: 'age_required',
  minor_not_allowed: 'minor_not_allowed',
  too_large: 'too_large',
  unsupported_media_type: 'unsupported_media_type',
}
const API_STATUS: Record<number, RecordErrorClass> = {
  402: 'quota_exceeded',
  413: 'too_large',
  415: 'unsupported_media_type',
}

function domName(err: unknown): string {
  if (err instanceof Error) return err.name
  if (typeof err === 'object' && err !== null && 'name' in err)
    return String(err.name)
  return ''
}

/** Map anything thrown by getUserMedia / MediaRecorder / IndexedDB / the API to one taxonomy entry. */
export function classify(err: unknown): RecordError {
  if (err instanceof ApiError) {
    const cls = API_CODES[err.code] ?? API_STATUS[err.status]
    if (cls) return errorOf(cls)
    return errorOf(err.status >= 500 ? 'upload_failed' : 'unknown')
  }
  switch (domName(err)) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return errorOf('permission_denied')
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return errorOf('device_missing')
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return errorOf('device_busy')
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return errorOf('overconstrained')
    case 'NotSupportedError':
      return errorOf('codec_unsupported')
    case 'UnsupportedLayout':
      return errorOf('unsupported')
    case 'ScreenCancelled':
      return errorOf('screen_cancelled')
    case 'QuotaExceededError':
      return errorOf('out_of_space')
    case 'EncodingError':
    case 'InvalidStateError':
    case 'UnknownError':
      return errorOf('recorder_error')
    case 'TypeError':
      // fetch() rejects with TypeError when the network is down.
      return errorOf(
        err instanceof Error && /fetch|network|load failed/i.test(err.message)
          ? 'network'
          : 'unknown',
      )
  }
  return errorOf('unknown')
}

/** Short stable label for the `record_error {class}` telemetry event. */
export const telemetryClass = (e: RecordError): RecordErrorClass => e.class
