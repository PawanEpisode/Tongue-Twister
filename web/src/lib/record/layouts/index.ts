/**
 * The layout registry. To add a layout: write one file in this folder, add it to `LAYOUT_LIST` and its
 * id to `RecordingLayout` in `lib/api.ts`. Nothing else needs to change (pickers, capability checks,
 * session wiring and telemetry all read from here).
 */
import type { RecordingLayout } from '../../api'
import { cameraLayout } from './camera'
import { cameraTextLayout } from './cameraText'
import { pipLayout } from './pip'
import { portraitLayout } from './portrait'
import { regionLayout } from './region'
import { screenBubbleLayout } from './screenBubble'
import { sideBySideLayout } from './sideBySide'
import type { LayoutDef, LayoutState } from './types'
import { DEFAULT_BUBBLE } from './geometry'

export type { LayoutDef, LayoutState } from './types'

/** In picker order (L1…L7). */
export const LAYOUT_LIST: readonly LayoutDef[] = [
  cameraLayout,
  cameraTextLayout,
  sideBySideLayout,
  screenBubbleLayout,
  pipLayout,
  portraitLayout,
  regionLayout,
]

export const DEFAULT_LAYOUT: RecordingLayout = 'camera_text'

const BY_ID = new Map<string, LayoutDef>(LAYOUT_LIST.map((l) => [l.id, l]))

export const isLayoutId = (v: unknown): v is RecordingLayout =>
  typeof v === 'string' && BY_ID.has(v)

export function getLayout(id: RecordingLayout): LayoutDef {
  const def = BY_ID.get(id)
  // The registry is closed over RecordingLayout, so this only fires if a layout file is missing from LAYOUT_LIST.
  if (!def) throw new Error(`Unknown layout: ${id}`)
  return def
}

export const DEFAULT_LAYOUT_STATE: LayoutState = {
  bubble: DEFAULT_BUBBLE,
  splitRatio: 0.5,
  textScale: 1,
  mirror: false,
}

/** Screen sources a layout needs, in one place for the session and the UI. */
export const usesCanvas = (l: LayoutDef, hasCamera: boolean): boolean =>
  !l.raw || (l.needs.camera && !hasCamera)
