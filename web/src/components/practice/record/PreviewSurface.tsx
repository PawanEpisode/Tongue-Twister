import { useEffect, useRef } from 'react'
import {
  bubbleRect,
  clampBubble,
  nudgeBubble,
  BUBBLE_SIZES,
} from '#/lib/record/layouts/geometry'
import type { Session } from '#/lib/record/session'
import type { RecordSettings } from '#/lib/record/settings'
import type { BubbleState } from '#/lib/record/layouts/types'
import { cn } from '#/lib/utils'

/**
 * What will be recorded, live: the compositor's preview canvas, or the raw camera stream for camera-only.
 * For the screen layout it also carries the draggable, resizable camera bubble.
 */
export default function PreviewSurface({
  session,
  settings,
  onBubble,
  editableBubble,
  children,
}: {
  session: Session
  settings: RecordSettings
  onBubble: (b: BubbleState) => void
  /** Let the user move/resize the bubble (preview and recording). */
  editableBubble: boolean
  children?: React.ReactNode
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)

  useEffect(() => {
    session.setPreviewCanvas(canvas.current)
    return () => session.setPreviewCanvas(null)
  }, [session])

  useEffect(() => {
    const el = video.current
    if (!el) return
    el.srcObject = session.previewStream
    void el.play().catch(() => undefined)
    return () => {
      el.srcObject = null
    }
  }, [session])

  const { width, height } = session.size
  const bubble =
    session.layout.id === 'screen_bubble' &&
    session.hasCamera &&
    session.hasScreen
  const rect = bubbleRect(session.size, settings.bubble)

  // Pointer drag on the bubble; the same maths as the arrow keys.
  const drag = useRef<{ x: number; y: number; mode: 'move' | 'resize' } | null>(
    null,
  )
  const start = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, mode }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    const box = frame.current?.getBoundingClientRect()
    if (!d || !box) return
    const scale = width / box.width // screen px → canvas px
    const dx = (e.clientX - d.x) * scale
    const dy = (e.clientY - d.y) * scale
    drag.current = { ...d, x: e.clientX, y: e.clientY }
    if (d.mode === 'move')
      onBubble(nudgeBubble(settings.bubble, session.size, dx, dy))
    else
      onBubble(
        clampBubble(
          {
            ...settings.bubble,
            size:
              settings.bubble.size + (dx + dy) / 2 / Math.min(width, height),
          },
          session.size,
        ),
      )
  }
  const end = () => {
    drag.current = null
  }
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 48 : 16
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const m = moves[e.key]
    if (m) {
      e.preventDefault()
      onBubble(nudgeBubble(settings.bubble, session.size, m[0], m[1]))
    } else if (e.key === '+' || e.key === '=' || e.key === '-') {
      e.preventDefault()
      const delta = e.key === '-' ? -0.03 : 0.03
      onBubble(
        clampBubble(
          { ...settings.bubble, size: settings.bubble.size + delta },
          session.size,
        ),
      )
    }
  }

  return (
    <div
      ref={frame}
      className="relative mx-auto w-full overflow-hidden rounded-2xl border border-border bg-black"
      style={{
        aspectRatio: `${width} / ${height}`,
        maxWidth: height > width ? '22rem' : '48rem',
      }}
    >
      {session.layout.id === 'region' ? (
        // The recorded picture is the practice stage itself (shown above), so a preview of it would only
        // loop back on itself. This box just carries the countdown and REC overlays.
        <div className="absolute inset-0 grid place-items-center p-4 text-center text-sm text-muted-foreground">
          Recording the practice stage above — nothing else on this page.
        </div>
      ) : session.composited ? (
        <canvas
          ref={canvas}
          role="img"
          aria-label="Live preview of your recording"
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <video
          ref={video}
          muted
          playsInline
          aria-label="Live camera preview"
          className={cn(
            'absolute inset-0 h-full w-full object-cover',
            settings.mirrorPreview &&
              session.layout.id === 'camera' &&
              '-scale-x-100',
          )}
        />
      )}
      {bubble && editableBubble && (
        <div
          role="group"
          tabIndex={0}
          aria-label="Camera bubble. Arrow keys move it, plus and minus resize it."
          onKeyDown={onKey}
          onPointerDown={start('move')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="absolute cursor-grab touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          style={{
            left: `${(rect.x / width) * 100}%`,
            top: `${(rect.y / height) * 100}%`,
            width: `${(rect.w / width) * 100}%`,
            height: `${(rect.h / height) * 100}%`,
          }}
        >
          <span
            onPointerDown={start('resize')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            aria-hidden
            className="absolute -bottom-1 -right-1 size-4 cursor-nwse-resize touch-none rounded-full border-2 border-white bg-primary"
          />
        </div>
      )}
      {children}
    </div>
  )
}

export const BUBBLE_PRESETS = [
  ['S', BUBBLE_SIZES.S],
  ['M', BUBBLE_SIZES.M],
  ['L', BUBBLE_SIZES.L],
] as const
