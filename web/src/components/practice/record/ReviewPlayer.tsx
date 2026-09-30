import {
  Captions,
  ChevronLeft,
  ChevronRight,
  FlipHorizontal2,
  Maximize,
  Pause,
  Play,
  SkipForward,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { cueAt } from '#/lib/record/captions'
import type { Cue } from '#/lib/record/captions'
import { formatClock } from '#/lib/record/quality'
import { nextMarker } from '#/lib/record/markers'
import type { Marker } from '#/lib/record/markers'
import { useFullscreen } from '#/lib/useFullscreen'
import { useHotkeys } from '#/lib/useHotkeys'
import { cn } from '#/lib/utils'

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
const FRAME_S = 1 / 30
const SKIP_S = 5

/**
 * The playback surface shared by the review step, the recordings list and the public page: scrub bar with
 * mistake markers, speed, captions, mirror, frame-step, fullscreen and "next mistake". Every control is a
 * real button, and the same actions have keys (Space, ← →, `,` `.`, N, C, M, F).
 */
export default function ReviewPlayer({
  src,
  durationMs,
  markers = [],
  cues,
  captionsSrc,
  initialMirror = false,
  hotkeys = true,
  label = 'Recording',
}: {
  src: string
  durationMs: number
  markers?: readonly Marker[]
  /** Local takes: cues drive the karaoke line. Saved ones rely on `captionsSrc` and the browser's renderer. */
  cues?: readonly Cue[]
  captionsSrc?: string | null
  initialMirror?: boolean
  hotkeys?: boolean
  label?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const fs = useFullscreen<HTMLDivElement>()
  const [playing, setPlaying] = useState(false)
  const [now, setNow] = useState(0)
  const [length, setLength] = useState(durationMs / 1000)
  const [speed, setSpeed] = useState<number>(1)
  const [captions, setCaptions] = useState(false)
  const [mirror, setMirror] = useState(initialMirror)
  const [failed, setFailed] = useState(false)
  const hasCaptions = !!captionsSrc || !!cues?.length

  const el = () => video.current

  const toggle = useCallback(() => {
    const v = el()
    if (!v) return
    if (v.paused) void v.play().catch(() => setFailed(true))
    else v.pause()
  }, [])
  const seek = useCallback((s: number) => {
    const v = el()
    if (!v) return
    const max = Number.isFinite(v.duration) ? v.duration : Infinity
    v.currentTime = Math.min(max, Math.max(0, s))
    setNow(v.currentTime)
  }, [])
  const step = useCallback(
    (dir: 1 | -1) => {
      const v = el()
      if (!v) return
      v.pause()
      seek(v.currentTime + dir * FRAME_S)
    },
    [seek],
  )
  const jumpToMistake = useCallback(() => {
    const v = el()
    const m = nextMarker(markers, (v?.currentTime ?? 0) * 1000) ?? markers[0]
    if (m) seek(Math.max(0, m.ms / 1000 - 0.5))
  }, [markers, seek])

  useEffect(() => {
    const v = el()
    if (v) v.playbackRate = speed
  }, [speed, src])

  // Native captions: shown only when there is no cue list to draw ourselves.
  useEffect(() => {
    const v = el()
    if (!v) return
    const apply = () => {
      for (const t of Array.from(v.textTracks))
        t.mode = captions && !cues ? 'showing' : 'hidden'
    }
    apply()
    v.textTracks.addEventListener?.('addtrack', apply)
    return () => v.textTracks.removeEventListener?.('addtrack', apply)
  }, [captions, cues, captionsSrc])

  useHotkeys(
    {
      ' ': toggle,
      ArrowLeft: () => seek((el()?.currentTime ?? 0) - SKIP_S),
      ArrowRight: () => seek((el()?.currentTime ?? 0) + SKIP_S),
      ',': () => step(-1),
      '.': () => step(1),
      n: jumpToMistake,
      c: () => hasCaptions && setCaptions((c) => !c),
      m: () => setMirror((m) => !m),
      f: fs.toggle,
    },
    hotkeys,
  )

  const cue = captions && cues ? cueAt(cues, now * 1000) : null
  const total = Math.max(length, 0.001)

  return (
    <div
      ref={fs.ref}
      className={cn(
        'space-y-3',
        fs.active && 'flex h-full flex-col justify-center bg-black p-4',
      )}
    >
      <div className="relative overflow-hidden rounded-2xl border border-border bg-black">
        <video
          ref={video}
          src={src}
          aria-label={label}
          playsInline
          preload="metadata"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setLength(d)
            e.currentTarget.playbackRate = speed
          }}
          onError={() => setFailed(true)}
          className={cn(
            'mx-auto max-h-[70vh] w-full',
            mirror && '-scale-x-100',
          )}
        >
          {captionsSrc && (
            <track
              kind="captions"
              srcLang="en"
              label="Captions"
              src={captionsSrc}
            />
          )}
        </video>
        {cue && (
          <p
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit max-w-[90%] rounded-lg bg-black/70 px-3 py-1.5 text-center font-display text-lg font-bold text-white"
          >
            {cue.text}
          </p>
        )}
        {failed && (
          <p
            role="alert"
            className="absolute inset-0 grid place-items-center bg-black/80 p-4 text-center text-sm text-white"
          >
            This browser can’t play this video. Download it to watch in another
            player.
          </p>
        )}
      </div>

      <div className="relative">
        <input
          type="range"
          aria-label="Position"
          aria-valuetext={`${formatClock(now * 1000)} of ${formatClock(total * 1000)}`}
          min={0}
          max={total}
          step={0.01}
          value={Math.min(now, total)}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-2 w-full cursor-pointer accent-[var(--primary)]"
        />
        {markers.length > 0 && (
          <ul
            className="pointer-events-none absolute inset-x-0 -top-1 h-4"
            aria-label="Mistakes"
          >
            {markers.map((m, i) => (
              <li
                key={`${m.ms}-${i}`}
                className="absolute top-0 -translate-x-1/2"
                style={{
                  left: `${Math.min(100, (m.ms / 1000 / total) * 100)}%`,
                }}
              >
                <button
                  type="button"
                  aria-label={`Jump to ${m.label}`}
                  title={m.label}
                  onClick={() => seek(Math.max(0, m.ms / 1000 - 0.5))}
                  className={cn(
                    'pointer-events-auto block h-4 w-2 rounded-sm focus-visible:ring-2 focus-visible:ring-ring',
                    m.severity === 'miss' ? 'bg-pink' : 'bg-amber-500',
                  )}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        <Button
          size="sm"
          variant="outline"
          onClick={() => step(-1)}
          aria-label="Back one frame"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <Button
          size="sm"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => step(1)}
          aria-label="Forward one frame"
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        <span className="tabular-nums text-muted-foreground" aria-hidden>
          {formatClock(now * 1000)} / {formatClock(total * 1000)}
        </span>
        <label className="flex items-center gap-1 text-muted-foreground">
          Speed
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="rounded-lg border border-input bg-card px-2 py-1 text-foreground"
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        {hasCaptions && (
          <Button
            size="sm"
            variant={captions ? 'default' : 'outline'}
            aria-pressed={captions}
            onClick={() => setCaptions((c) => !c)}
          >
            <Captions className="mr-1 size-4" aria-hidden />
            Captions
          </Button>
        )}
        <Button
          size="sm"
          variant={mirror ? 'default' : 'outline'}
          aria-pressed={mirror}
          onClick={() => setMirror((m) => !m)}
        >
          <FlipHorizontal2 className="mr-1 size-4" aria-hidden />
          Mirror
        </Button>
        {markers.length > 0 && (
          <Button size="sm" variant="outline" onClick={jumpToMistake}>
            <SkipForward className="mr-1 size-4" aria-hidden />
            Next mistake
          </Button>
        )}
        {fs.supported && (
          <Button
            size="sm"
            variant="outline"
            onClick={fs.toggle}
            aria-label="Fullscreen"
          >
            <Maximize className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )
}
