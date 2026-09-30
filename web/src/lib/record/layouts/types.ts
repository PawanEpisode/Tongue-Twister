import type { RecordingLayout } from '../../api'
import type { Resolution } from '../quality'

/** What a layout needs from the device; the capability matrix turns this into enabled / disabled-with-reason. */
export type LayoutNeeds = {
  camera: boolean
  screen: boolean
  /** Element / Region Capture of our own page (Chromium desktop). */
  region?: boolean
  /** Composited on a canvas (so needs canvas capture + Web Audio). */
  canvas?: boolean
}

export type Rect = { x: number; y: number; w: number; h: number }
export type Size = { width: number; height: number }

/** Camera bubble for the screen layout: centre as a fraction of the canvas, diameter as a fraction of its short side. */
export type BubbleState = { cx: number; cy: number; size: number }

export type LayoutState = {
  bubble: BubbleState
  /** Share of the width given to the text in the side-by-side layout. */
  splitRatio: number
  /** Multiplier on the text size. */
  textScale: number
  /** Draw the camera flipped (a mirror). The saved video is not mirrored unless asked. */
  mirror: boolean
}

/** The twister text as the layouts see it; updated by the recorder UI every frame without re-rendering React. */
export type TextLayer = {
  words: readonly string[]
  /** Index of the word to read now (-1 = none). */
  current: number
  /** Words already said correctly (speech-driven highlighting). */
  hits: readonly boolean[]
}

/** Anything drawImage accepts that also tells us its size (a <video> or a canvas). */
export type FrameSource = CanvasImageSource & {
  videoWidth?: number
  videoHeight?: number
  width?: number | SVGAnimatedLength
  height?: number | SVGAnimatedLength
}

export type FrameInputs = {
  camera: FrameSource | null
  screen: FrameSource | null
  text: TextLayer
  /** Mic level 0–1, for the audio-only waveform. */
  level: number
  /** Recording clock, drives the tiny idle animation of the audio-only card. */
  elapsedMs: number
}

/** A picker thumbnail as plain shapes on a 160×90 (or 90×160 portrait) board, so the picker needs no per-layout code. */
export type ThumbShape = {
  x: number
  y: number
  w: number
  h: number
  role: 'camera' | 'text' | 'screen' | 'accent'
  /** Draw as a circle (the camera bubble). */
  round?: boolean
}

export type LayoutDef = {
  id: RecordingLayout
  label: string
  blurb: string
  needs: LayoutNeeds
  /** Records the source stream as is (no canvas): survives a hidden tab. Falls back to canvas if there is no camera. */
  raw?: boolean
  portrait?: boolean
  /** Shapes for the layout picker. */
  thumb: readonly ThumbShape[]
  size: (res: Resolution) => Size
  draw: (
    ctx: CanvasRenderingContext2D,
    size: Size,
    frame: FrameInputs,
    state: LayoutState,
  ) => void
}
