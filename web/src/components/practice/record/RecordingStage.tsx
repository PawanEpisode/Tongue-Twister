import {
  Circle,
  Pause,
  Play,
  RotateCcw,
  Square,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Dialog } from '#/components/ui/dialog'
import type { LostDevice } from '#/lib/record/useRecorder'
import type { MachineState } from '#/lib/record/machine'
import type { Session } from '#/lib/record/session'
import type { RecordSettings } from '#/lib/record/settings'
import type { BubbleState } from '#/lib/record/layouts/types'
import { formatClock } from '#/lib/record/quality'
import { useHotkeys } from '#/lib/useHotkeys'
import PreviewSurface from './PreviewSurface'

type Confirm = 'stop' | 'restart' | 'discard' | null

const WARNING_COPY = {
  60: 'One minute left.',
  30: '30 seconds left of your limit.',
  10: '10 seconds left.',
} as const

/** The live take: the same picture, a countdown that is not recorded, REC + timer, and every control. */
export default function RecordingStage({
  state,
  session,
  settings,
  lost,
  screenStopped,
  busy,
  announcement,
  onBubble,
  onPause,
  onResume,
  onStop,
  onRestart,
  onDiscard,
  onCancelCountdown,
  onContinueWithoutScreen,
  overlay,
}: {
  state: MachineState
  session: Session
  settings: RecordSettings
  lost: LostDevice
  screenStopped: boolean
  busy: boolean
  announcement: string
  onBubble: (b: BubbleState) => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  onRestart: () => void
  onDiscard: () => void
  onCancelCountdown: () => void
  onContinueWithoutScreen: () => void
  overlay?: ReactNode
}) {
  const [confirm, setConfirm] = useState<Confirm>(null)
  const { phase } = state
  const live = phase === 'recording' || phase === 'paused'
  const left = Math.max(0, state.limitMs - state.elapsedMs)

  // Keyboard layer (PRD 04 §4.3): Space pauses, Esc stops (after a confirm), R restarts (after a confirm).
  useHotkeys(
    {
      ' ': () =>
        phase === 'recording'
          ? onPause()
          : phase === 'paused'
            ? onResume()
            : undefined,
      Escape: () =>
        live
          ? setConfirm('stop')
          : phase === 'countdown'
            ? onCancelCountdown()
            : undefined,
      r: () => (live ? setConfirm('restart') : undefined),
      R: () => (live ? setConfirm('restart') : undefined),
    },
    (live || phase === 'countdown') && confirm === null,
  )

  const banner =
    phase === 'paused' && state.pause === 'tab_hidden'
      ? 'Paused because you switched tabs. Recording needs this tab visible — come back and press Resume.'
      : phase === 'paused' && state.pause === 'device_lost'
        ? `${lost === 'mic' ? 'Microphone' : 'Camera'} disconnected. Reconnect it, then press Resume — or finish now and keep what you have.`
        : phase === 'paused' && state.pause === 'screen_stopped'
          ? 'Screen sharing stopped. Carry on with your camera only, or finish now.'
          : null

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PreviewSurface
        session={session}
        settings={settings}
        onBubble={onBubble}
        editableBubble={
          session.layout.id === 'screen_bubble' && live && !screenStopped
        }
      >
        {overlay}
        <AnimatePresence>
          {phase === 'countdown' && (
            <m.div
              key={state.countdown}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 1.4, opacity: 0 }}
              aria-hidden
              className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40 font-display text-8xl font-extrabold text-white"
            >
              {state.countdown}
            </m.div>
          )}
        </AnimatePresence>
        {live && (
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-sm font-semibold text-white">
            {phase === 'recording' ? (
              <Circle
                className="size-3 animate-pulse fill-red-500 text-red-500"
                aria-hidden
              />
            ) : (
              <Pause className="size-3" aria-hidden />
            )}
            <span>{phase === 'recording' ? 'REC' : 'Paused'}</span>
            <span className="tabular-nums" aria-hidden>
              {formatClock(state.elapsedMs)}
            </span>
          </div>
        )}
      </PreviewSurface>

      {/* Announced by screen readers: state changes and every 30 s, never every second. */}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {phase === 'countdown' && (
        <p className="sr-only" role="status" aria-live="assertive">
          Recording starts in {state.countdown}
        </p>
      )}

      {live && (
        <div className="mx-auto max-w-md space-y-1">
          <div
            role="progressbar"
            aria-label="Recording time used"
            aria-valuemin={0}
            aria-valuemax={Math.round(state.limitMs / 1000)}
            aria-valuenow={Math.round(state.elapsedMs / 1000)}
            aria-valuetext={`${formatClock(state.elapsedMs)} of ${formatClock(state.limitMs)}`}
            className="h-1.5 overflow-hidden rounded-full bg-card"
          >
            <div
              className={`h-full rounded-full ${left <= 30_000 ? 'bg-pink' : 'bg-primary'}`}
              style={{
                width: `${Math.min(100, (state.elapsedMs / state.limitMs) * 100)}%`,
              }}
            />
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatClock(state.elapsedMs)} of {formatClock(state.limitMs)}
            {state.warned && left > 0 ? ` · ${WARNING_COPY[state.warned]}` : ''}
          </p>
        </div>
      )}

      {banner && (
        <div
          role="alert"
          className="mx-auto flex max-w-md items-start gap-2 rounded-2xl bg-pink/10 p-3 text-left text-sm"
        >
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-pink"
            aria-hidden
          />
          <p>{banner}</p>
        </div>
      )}
      {session.hasScreen &&
        !session.hasSystemAudio &&
        phase === 'countdown' && (
          <p className="text-xs text-muted-foreground">
            No tab audio was shared, so only your voice is recorded.
          </p>
        )}

      <div className="flex flex-wrap justify-center gap-3">
        {phase === 'countdown' && (
          <Button variant="outline" onClick={onCancelCountdown}>
            Cancel
          </Button>
        )}
        {live && (
          <>
            {phase === 'recording' ? (
              <Button variant="outline" onClick={onPause}>
                <Pause className="mr-2 size-4" aria-hidden />
                Pause
              </Button>
            ) : screenStopped ? (
              <Button variant="outline" onClick={onContinueWithoutScreen}>
                <Play className="mr-2 size-4" aria-hidden />
                Continue with camera only
              </Button>
            ) : (
              <Button variant="outline" disabled={busy} onClick={onResume}>
                <Play className="mr-2 size-4" aria-hidden />
                {busy
                  ? 'Reconnecting…'
                  : lost
                    ? 'Reconnect and resume'
                    : 'Resume'}
              </Button>
            )}
            <Button
              size="lg"
              onClick={() => setConfirm('stop')}
              className="bg-pink text-pink-foreground"
            >
              <Square className="mr-2 size-4 fill-current" aria-hidden />
              {state.pause === 'device_lost' || state.pause === 'screen_stopped'
                ? 'Finish now'
                : 'Stop'}
            </Button>
            <Button variant="outline" onClick={() => setConfirm('restart')}>
              <RotateCcw className="mr-2 size-4" aria-hidden />
              Restart
            </Button>
            <Button variant="ghost" onClick={() => setConfirm('discard')}>
              <Trash2 className="mr-2 size-4" aria-hidden />
              Discard
            </Button>
          </>
        )}
        {phase === 'finalizing' && (
          <p role="status" className="text-sm text-muted-foreground">
            Finishing your recording…
          </p>
        )}
      </div>
      {live && (
        <p className="text-xs text-muted-foreground">
          <kbd className="rounded border border-border px-1">Space</kbd> pause ·{' '}
          <kbd className="rounded border border-border px-1">Esc</kbd> stop ·{' '}
          <kbd className="rounded border border-border px-1">R</kbd> restart
        </p>
      )}

      <Dialog
        open={confirm === 'stop'}
        onClose={() => setConfirm(null)}
        title="Stop recording?"
        description="We’ll finish this take and open the review."
      >
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Keep recording
          </Button>
          <Button
            onClick={() => {
              setConfirm(null)
              onStop()
            }}
          >
            Stop
          </Button>
        </div>
      </Dialog>
      <Dialog
        open={confirm === 'restart' || confirm === 'discard'}
        onClose={() => setConfirm(null)}
        title={
          confirm === 'discard'
            ? 'Discard this take?'
            : 'Start this take again?'
        }
        description="What you’ve recorded so far will be deleted from this device."
      >
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="outline" onClick={() => setConfirm(null)}>
            Keep it
          </Button>
          <Button
            onClick={() => {
              const c = confirm
              setConfirm(null)
              if (c === 'discard') onDiscard()
              else onRestart()
            }}
          >
            {confirm === 'discard' ? 'Discard' : 'Restart'}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
