import { Loader2, Mic, Square } from 'lucide-react'
import { AnimatePresence, m } from 'motion/react'
import pulse from '#/assets/lottie/pulse.json'
import AudioVisualizer from '#/components/AudioVisualizer'
import Lottie from '#/components/ClientLottie'
import type { Take } from '#/lib/useTake'
import PermissionNotice from './PermissionNotice'

const STATUS: Record<string, string> = {
  listening: 'Listening… say it now',
  hearing: 'Hearing you…',
  processing: 'Got it — working out the words…',
}

/** The mic button with its visualiser, GO! flash, status line and every notice around it. */
export default function MicStage({
  take,
  onReadAlong,
  idleHint = 'Tap the mic, wait for GO!, then say it as fast as you can',
  heardHint = 'Keep going — I’ll stop when you finish',
  unsupportedHint = 'Speech recognition isn’t supported in this browser — type it below',
}: {
  take: Take
  onReadAlong?: () => void
  idleHint?: string
  /** Status line once words are on screen. */
  heardHint?: string
  unsupportedHint?: string
}) {
  const {
    speech,
    mic,
    lock,
    arming,
    live,
    showGo,
    startListening,
    hits,
    matched,
    spoken,
  } = take
  const allMatched = hits.length > 0 && matched === hits.length
  return (
    <>
      <div className="relative mx-auto mt-8 h-64 w-64">
        {arming && (
          <Lottie
            animationData={pulse}
            loop
            className="absolute inset-0 h-full w-full"
            fallback={
              <span
                aria-hidden
                className="absolute inset-[48px] animate-ping rounded-full bg-primary/25 motion-reduce:animate-none"
              />
            }
          />
        )}
        {live && (
          <AudioVisualizer
            analyser={speech.analyser}
            className="absolute inset-0 h-full w-full"
          />
        )}
        <AnimatePresence>
          {showGo && (
            <m.div
              key="go"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1.15, opacity: 1 }}
              exit={{ scale: 1.6, opacity: 0 }}
              className="pointer-events-none absolute inset-0 z-10 grid place-items-center font-display text-5xl font-extrabold text-lime hit-glow"
            >
              GO!
            </m.div>
          )}
        </AnimatePresence>
        <m.button
          whileTap={{ scale: 0.92 }}
          whileHover={{ scale: 1.05 }}
          disabled={!speech.supported || arming || (lock.blocked && !live)}
          onClick={live ? speech.stop : () => void startListening()}
          aria-label={live ? 'Stop' : 'Start speaking'}
          className={`absolute inset-[72px] grid place-items-center rounded-full shadow-xl disabled:cursor-wait ${live ? 'bg-pink text-pink-foreground shadow-pink/40' : 'bg-primary text-primary-foreground shadow-primary/40'} ${arming ? 'opacity-70' : ''}`}
        >
          {live ? (
            <Square className="size-8 fill-current" aria-hidden />
          ) : arming ? (
            <Loader2 className="size-8 animate-spin" aria-hidden />
          ) : (
            <Mic className="size-8" aria-hidden />
          )}
        </m.button>
      </div>

      <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
        {arming
          ? 'Getting your mic ready… wait for GO!'
          : live
            ? speech.phase === 'heard'
              ? heardHint
              : STATUS[speech.phase]
            : speech.supported
              ? idleHint
              : unsupportedHint}
      </p>
      <PermissionNotice
        state={mic.state}
        kind="microphone"
        onRetry={() => void startListening()}
        onReadAlong={onReadAlong}
      />
      {lock.blocked && !live && (
        <p role="status" className="mt-2 text-sm text-pink">
          Practice is active in another tab — finish it there first.
        </p>
      )}
      {speech.error && <p className="mt-2 text-sm text-pink">{speech.error}</p>}
      {live && (
        <div
          className="mx-auto mt-3 grid min-h-[3.5rem] max-w-xl place-items-center"
          aria-live="polite"
        >
          {speech.transcript ? (
            <p
              data-testid="heard"
              className={`font-display text-2xl font-bold transition-colors ${allMatched ? 'text-lime' : 'text-foreground'} ${speech.interim ? 'opacity-80' : ''}`}
            >
              “{allMatched ? spoken : speech.transcript}”
            </p>
          ) : speech.phase === 'hearing' || speech.phase === 'processing' ? (
            <span
              aria-hidden
              className="flex items-end gap-1.5 text-muted-foreground"
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-2 animate-bounce rounded-full bg-current motion-reduce:animate-none"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </span>
          ) : null}
        </div>
      )}
    </>
  )
}
