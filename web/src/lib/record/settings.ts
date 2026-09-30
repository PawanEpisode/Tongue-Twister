/** Record-mode settings: shape, defaults, validation of stored values, and persistence (never at import time). */
import type { RecordingLayout } from '../api'
import { readJson, writeJson } from '../storage'
import type { HighlightMode } from './highlight'
import { DEFAULT_LAYOUT, DEFAULT_LAYOUT_STATE, isLayoutId } from './layouts'
import { clampBubble, clampSplit } from './layouts/geometry'
import type { LayoutState } from './layouts'
import type { Resolution } from './quality'

export type CountdownS = 0 | 3 | 5

export type RecordSettings = {
  layout: RecordingLayout
  resolution: Resolution
  cameraId: string
  micId: string
  facing: 'user' | 'environment'
  highlight: HighlightMode
  /** null = automatic by difficulty, like Read-along. */
  wpm: number | null
  countdownS: CountdownS
  echoCancellation: boolean
  noiseSuppression: boolean
  /** The on-screen preview is a mirror. */
  mirrorPreview: boolean
  /** The saved file is mirrored too (off by default so writing on clothes reads correctly). */
  mirrorSaved: boolean
  showLiveScore: boolean
  autoStopOnFinish: boolean
  textScale: number
  splitRatio: number
  bubble: LayoutState['bubble']
}

export const DEFAULT_SETTINGS: RecordSettings = {
  layout: DEFAULT_LAYOUT,
  resolution: 'auto',
  cameraId: '',
  micId: '',
  facing: 'user',
  highlight: 'pacing',
  wpm: null,
  countdownS: 3,
  echoCancellation: true,
  noiseSuppression: true,
  mirrorPreview: true,
  mirrorSaved: false,
  showLiveScore: true,
  autoStopOnFinish: false,
  textScale: 1,
  splitRatio: DEFAULT_LAYOUT_STATE.splitRatio,
  bubble: DEFAULT_LAYOUT_STATE.bubble,
}

const RESOLUTIONS: readonly Resolution[] = ['auto', '720p', '1080p']
const HIGHLIGHTS: readonly HighlightMode[] = ['pacing', 'speech', 'both']
const COUNTDOWNS: readonly CountdownS[] = [0, 3, 5]

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, v))
    : fallback
const bool = (v: unknown, fallback: boolean) =>
  typeof v === 'boolean' ? v : fallback
const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : '')
const pick = <T>(v: unknown, all: readonly T[], fallback: T): T =>
  all.find((a) => a === v) ?? fallback

/** Anything from storage → a valid settings object (never throws; unknown or out-of-range values fall back). */
export function sanitizeSettings(raw: unknown): RecordSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<
    string,
    unknown
  >
  const d = DEFAULT_SETTINGS
  const bubble = (
    typeof r.bubble === 'object' && r.bubble !== null ? r.bubble : {}
  ) as Record<string, unknown>
  const canvas = { width: 1280, height: 720 }
  return {
    layout: isLayoutId(r.layout) ? r.layout : d.layout,
    resolution: pick(r.resolution, RESOLUTIONS, d.resolution),
    cameraId: str(r.cameraId),
    micId: str(r.micId),
    facing: r.facing === 'environment' ? 'environment' : 'user',
    highlight: pick(r.highlight, HIGHLIGHTS, d.highlight),
    wpm:
      r.wpm === null
        ? null
        : typeof r.wpm === 'number'
          ? num(r.wpm, 110, 40, 300)
          : null,
    countdownS: pick(r.countdownS, COUNTDOWNS, d.countdownS),
    echoCancellation: bool(r.echoCancellation, d.echoCancellation),
    noiseSuppression: bool(r.noiseSuppression, d.noiseSuppression),
    mirrorPreview: bool(r.mirrorPreview, d.mirrorPreview),
    mirrorSaved: bool(r.mirrorSaved, d.mirrorSaved),
    showLiveScore: bool(r.showLiveScore, d.showLiveScore),
    autoStopOnFinish: bool(r.autoStopOnFinish, d.autoStopOnFinish),
    textScale: num(r.textScale, d.textScale, 0.6, 2),
    splitRatio: clampSplit(num(r.splitRatio, d.splitRatio, 0, 1)),
    bubble: clampBubble(
      {
        cx: num(bubble.cx, d.bubble.cx, 0, 1),
        cy: num(bubble.cy, d.bubble.cy, 0, 1),
        size: num(bubble.size, d.bubble.size, 0, 1),
      },
      canvas,
    ),
  }
}

const KEY = 'twister.record.settings.v1'

export function loadSettings(): RecordSettings {
  return sanitizeSettings(readJson<Partial<RecordSettings>>(KEY, () => ({})))
}
export function saveSettings(s: RecordSettings): void {
  writeJson(KEY, s)
}

export function layoutStateOf(s: RecordSettings): LayoutState {
  return {
    bubble: s.bubble,
    splitRatio: s.splitRatio,
    textScale: s.textScale,
    mirror: s.mirrorSaved,
  }
}
