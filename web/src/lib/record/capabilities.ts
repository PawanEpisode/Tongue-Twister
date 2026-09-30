/**
 * What this browser can record with (PRD 04 §6, 08 §6 support matrix). Pure: the environment is
 * passed in, so the matrix is unit-tested with plain objects and nothing here touches globals at import.
 */
import type { LayoutNeeds } from './layouts/types'

export type Platform = 'ios' | 'android' | 'desktop'
/** `restriction` = Element Capture (Chrome 126+), `crop` = Region Capture (Chrome 104+). */
export type ElementCapture = 'restriction' | 'crop' | null

export type Capabilities = {
  platform: Platform
  chromium: boolean
  /** MediaRecorder + getUserMedia: without both the Record tab is hidden (edge case 10). */
  canRecord: boolean
  canvasCapture: boolean
  audioContext: boolean
  displayMedia: boolean
  elementCapture: ElementCapture
  wakeLock: boolean
  storageEstimate: boolean
  indexedDb: boolean
  faceDetector: boolean
}

/** The slice of `globalThis` we look at; every field optional so tests pass small objects. */
export type CapabilityEnv = {
  navigator?: {
    userAgent?: string
    maxTouchPoints?: number
    mediaDevices?: { getUserMedia?: unknown; getDisplayMedia?: unknown }
    wakeLock?: unknown
    storage?: { estimate?: unknown }
  }
  MediaRecorder?: unknown
  HTMLCanvasElement?: { prototype?: { captureStream?: unknown } }
  AudioContext?: unknown
  webkitAudioContext?: unknown
  RestrictionTarget?: unknown
  CropTarget?: unknown
  indexedDB?: unknown
  FaceDetector?: unknown
}

export function detectPlatform(ua: string, touchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  // iPadOS 13+ reports itself as a Mac with a touch screen.
  if (/Macintosh/i.test(ua) && touchPoints > 1) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

const isFn = (v: unknown) => typeof v === 'function'

export function detectCapabilities(
  env: CapabilityEnv = globalThis,
): Capabilities {
  const nav = env.navigator
  const ua = nav?.userAgent ?? ''
  const platform = detectPlatform(ua, nav?.maxTouchPoints)
  const chromium = platform !== 'ios' && /\b(Chrome|Chromium|Edg)\//.test(ua)
  const md = nav?.mediaDevices
  const getUserMedia = isFn(md?.getUserMedia)
  return {
    platform,
    chromium,
    canRecord: isFn(env.MediaRecorder) && getUserMedia,
    canvasCapture: isFn(env.HTMLCanvasElement?.prototype?.captureStream),
    audioContext: isFn(env.AudioContext) || isFn(env.webkitAudioContext),
    // Phones have (or had) no getDisplayMedia worth offering; hide screen layouts there (08 §6).
    displayMedia: platform === 'desktop' && isFn(md?.getDisplayMedia),
    elementCapture:
      platform !== 'desktop' || !chromium
        ? null
        : env.RestrictionTarget != null
          ? 'restriction'
          : env.CropTarget != null
            ? 'crop'
            : null,
    wakeLock: nav?.wakeLock != null,
    storageEstimate: isFn(nav?.storage?.estimate),
    indexedDb: env.indexedDB != null,
    faceDetector: isFn(env.FaceDetector),
  }
}

export type Support = { ok: true } | { ok: false; reason: string }

/** Whether a layout can run here, with the reason to show when it can't (unsupported ones are disabled, not silent). */
export function supportFor(caps: Capabilities, needs: LayoutNeeds): Support {
  if (!caps.canRecord)
    return { ok: false, reason: 'Recording isn’t supported in this browser.' }
  if (needs.canvas && !(caps.canvasCapture && caps.audioContext))
    return {
      ok: false,
      reason: 'This layout needs a newer browser (canvas recording).',
    }
  if (needs.screen && !caps.displayMedia)
    return {
      ok: false,
      reason:
        caps.platform === 'desktop'
          ? 'Screen capture isn’t available in this browser.'
          : 'Screen recording is desktop-only.',
    }
  if (needs.region && !caps.elementCapture)
    return {
      ok: false,
      reason: 'Recording part of the page needs Chrome or Edge on a computer.',
    }
  return { ok: true }
}
