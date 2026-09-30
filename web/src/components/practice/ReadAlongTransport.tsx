import {
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { formatDuration } from '#/lib/readAlong/timeline'
import type { EngineStatus } from '#/lib/readAlong/useReadAlong'

type Props = {
  status: EngineStatus
  index: number
  wordCount: number
  totalMs: number
  wpm: number
  loopLabel: string | null
  listenState: 'unavailable' | 'idle' | 'speaking'
  focus: { supported: boolean; active: boolean }
  onToggle: () => void
  onRestart: () => void
  onStep: (delta: number) => void
  onSeek: (i: number) => void
  onListen: () => void
  onFocus: () => void
  onHelp: () => void
}

function speedNote(wpm: number) {
  if (wpm < 50) return 'Very slow — great for warm-ups.'
  if (wpm > 250) return 'Faster than most humans can speak clearly.'
  return null
}

/** Play/pause/seek row, scrubber and the small print under the stage. */
export default function ReadAlongTransport(p: Props) {
  const running = p.status === 'running' || p.status === 'countdown'
  const note = speedNote(p.wpm)
  return (
    <>
      <input
        type="range"
        min={0}
        max={Math.max(0, p.wordCount - 1)}
        value={p.index}
        onChange={(e) => p.onSeek(Number(e.target.value))}
        aria-label="Position in the twister"
        aria-valuetext={`Word ${p.index + 1} of ${p.wordCount}`}
        className="mt-4 w-full accent-brand"
      />
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="px-4 py-3"
          onClick={p.onRestart}
          aria-label="Restart"
        >
          <RotateCcw className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="px-4 py-3"
          onClick={() => p.onStep(-1)}
          aria-label="Back one word"
        >
          <SkipBack className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          className="min-w-32 gap-2 px-6 py-3"
          onClick={p.onToggle}
        >
          {running ? (
            <Pause className="size-4 fill-current" aria-hidden />
          ) : (
            <Play className="size-4 fill-current" aria-hidden />
          )}
          {running ? 'Pause' : p.status === 'paused' ? 'Resume' : 'Start'}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="px-4 py-3"
          onClick={() => p.onStep(1)}
          aria-label="Forward one word"
        >
          <SkipForward className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="gap-2 px-4 py-3"
          onClick={p.onListen}
          disabled={p.listenState === 'unavailable'}
          title={
            p.listenState === 'unavailable'
              ? 'No English voice is available in this browser.'
              : 'Hear a model reading'
          }
        >
          {p.listenState === 'speaking' ? (
            <VolumeX className="size-4" aria-hidden />
          ) : (
            <Volume2 className="size-4" aria-hidden />
          )}
          {p.listenState === 'speaking' ? 'Stop' : 'Listen'}
        </Button>
        {p.focus.supported && (
          <Button
            type="button"
            variant="outline"
            className="px-4 py-3"
            onClick={p.onFocus}
            aria-pressed={p.focus.active}
            aria-label="Focus mode"
          >
            {p.focus.active ? (
              <Minimize className="size-4" aria-hidden />
            ) : (
              <Maximize className="size-4" aria-hidden />
            )}
          </Button>
        )}
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">
        ~{formatDuration(p.totalMs)} at {p.wpm} WPM
        {p.loopLabel ? ` · ${p.loopLabel}` : ''}
        {' · '}
        <button className="underline" onClick={p.onHelp}>
          Keyboard shortcuts
        </button>
        {note && <span role="status"> · {note}</span>}
      </p>
    </>
  )
}
