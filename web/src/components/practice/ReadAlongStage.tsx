import { useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef } from 'react'
import type { DisplayStyle, Preferences } from '#/lib/api'
import { PREFERENCE_RANGES } from '#/lib/preferences'
import { splitLines } from '#/lib/readAlong/text'
import { fractionAt } from '#/lib/readAlong/timeline'
import type { Timeline } from '#/lib/readAlong/timeline'
import type { FrameListener } from '#/lib/readAlong/useReadAlong'
import { usePinchZoom } from '#/lib/usePinchZoom'

type Look = Pick<
  Preferences,
  | 'threshold_pct'
  | 'font_scale'
  | 'mirror_text'
  | 'dyslexia_font'
  | 'high_contrast'
>
type Props = {
  timeline: Timeline
  index: number
  style: DisplayStyle
  look: Look
  reduceMotion: boolean
  subscribe: (fn: FrameListener) => () => void
  onSeek: (i: number) => void
  /** Long-press on a word: begin reading from there. */
  onStartFrom: (i: number) => void
  /** Pinch / ctrl+wheel on the text. */
  onFontScale: (scale: number) => void
  /** Struggling device: fall back to word-step, no smooth motion. */
  degraded: boolean
  focus: boolean
}

const LONG_PRESS_MS = 500
const baseRem = (words: number) =>
  words <= 12 ? 2.25 : words <= 30 ? 1.75 : 1.25

/** Put `el` on the threshold line (a % of the container's height). */
function alignToThreshold(
  box: HTMLElement,
  el: HTMLElement,
  pct: number,
  smooth: boolean,
) {
  const top =
    el.offsetTop + el.offsetHeight / 2 - (box.clientHeight * pct) / 100
  box.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
}

function wordClass(
  i: number,
  current: number,
  contrast: boolean,
  animate: boolean,
) {
  const motion = animate ? 'transition-colors duration-150' : ''
  if (i === current)
    return `${motion} rounded-md px-1 underline decoration-2 underline-offset-4 ${contrast ? 'bg-yellow-300 text-black decoration-black' : 'bg-brand/30 text-white decoration-brand'}`
  return `${motion} px-1 ${i < current ? 'text-white/35' : 'text-white/90'}`
}

export default function ReadAlongStage({
  timeline,
  index,
  style: requested,
  look,
  reduceMotion,
  subscribe,
  onSeek,
  onStartFrom,
  onFontScale,
  degraded,
  focus,
}: Props) {
  const osReduced = useReducedMotion()
  const animate = !(reduceMotion || osReduced || degraded)
  const style = requested === 'scroll' && degraded ? 'word' : requested
  const press = useRef<{
    timer?: ReturnType<typeof setTimeout>
    fired: boolean
  }>({ fired: false })
  const box = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  usePinchZoom(box, look.font_scale, PREFERENCE_RANGES.font_scale, onFontScale)
  const els = useRef<(HTMLElement | null)[]>([])
  const lines = useMemo(() => splitLines(timeline.tokens), [timeline.tokens])
  const lineOf = (i: number) => lines.findIndex((l) => l.includes(i))
  const currentLine = lineOf(index)

  // word / line: keep the current word (or line) on the threshold line.
  useEffect(() => {
    if (style === 'scroll' || !box.current) return
    const target =
      els.current[style === 'line' ? lines[currentLine]?.[0] : index]
    if (target)
      alignToThreshold(box.current, target, look.threshold_pct, animate)
  }, [style, index, currentLine, lines, look.threshold_pct, animate])

  // scroll: continuous teleprompter — the word under the reading line moves per frame, imperatively.
  useEffect(() => {
    if (style !== 'scroll') return
    const place = (elapsed: number, i: number) => {
      const here = els.current[i]
      const next = els.current[i + 1]
      if (!here || !box.current || !track.current) return
      const span = next ? next.offsetTop - here.offsetTop : here.offsetHeight
      const y =
        here.offsetTop +
        here.offsetHeight / 2 +
        fractionAt(timeline, elapsed) * span
      track.current.style.transform = `translateY(${(box.current.clientHeight * look.threshold_pct) / 100 - y}px)`
    }
    place(timeline.starts[index] ?? 0, index)
    return subscribe(place)
  }, [style, timeline, index, look.threshold_pct, look.font_scale, subscribe])

  const words = (ids: number[]) =>
    ids.map((i) => (
      <button
        key={i}
        type="button"
        tabIndex={-1}
        ref={(el) => {
          els.current[i] = el
        }}
        onPointerDown={() => {
          press.current.fired = false
          press.current.timer = setTimeout(() => {
            press.current.fired = true
            onStartFrom(i)
          }, LONG_PRESS_MS)
        }}
        onPointerUp={() => clearTimeout(press.current.timer)}
        onPointerLeave={() => clearTimeout(press.current.timer)}
        onPointerCancel={() => clearTimeout(press.current.timer)}
        onClick={(e) => {
          e.stopPropagation() // seeking must not also toggle play/pause on the stage
          if (!press.current.fired) onSeek(i)
        }}
        className={`inline-block cursor-pointer ${wordClass(i, index, look.high_contrast, animate)}`}
      >
        {timeline.tokens[i]}
      </button>
    ))

  return (
    <div
      ref={box}
      className={`relative min-h-64 touch-pan-y rounded-2xl ${focus ? 'h-[70vh]' : 'h-[42vh]'} border border-line/60 bg-panel/40 p-5 ${style === 'scroll' ? 'overflow-hidden' : 'overflow-y-auto'} ${look.mirror_text ? '-scale-x-100' : ''}`}
      style={{
        fontSize: `${baseRem(timeline.tokens.length) * look.font_scale}rem`,
        fontFamily: look.dyslexia_font ? 'var(--font-dyslexic)' : undefined,
      }}
    >
      {/* Visual words are decorative for screen readers; the full text is read once (PRD 02 §8.10). */}
      <div
        ref={track}
        aria-hidden
        className="font-display font-bold leading-snug"
      >
        {style === 'line' ? (
          lines.map((ids, n) => (
            <p
              key={n}
              className={`my-3 text-center ${animate ? 'transition-opacity duration-200' : ''} ${n === currentLine ? 'opacity-100' : Math.abs(n - currentLine) <= 2 ? 'opacity-40' : 'opacity-15'}`}
            >
              {words(ids)}
            </p>
          ))
        ) : (
          <p className={style === 'scroll' ? 'text-center' : 'text-left'}>
            {words(timeline.tokens.map((_, i) => i))}
          </p>
        )}
      </div>
      <p className="sr-only">{timeline.tokens.join(' ')}</p>
      {style !== 'line' && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-brand/40"
          style={{ top: `${look.threshold_pct}%` }}
        />
      )}
    </div>
  )
}
