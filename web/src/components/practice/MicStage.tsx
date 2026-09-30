import { AnimatePresence, motion } from 'motion/react'
import pulse from '#/assets/lottie/pulse.json'
import AudioVisualizer from '#/components/AudioVisualizer'
import Lottie from '#/components/ClientLottie'
import type { Take } from '#/lib/useTake'
import PermissionNotice from './PermissionNotice'

/** The mic button with its visualiser, GO! flash, status line and every notice around it. */
export default function MicStage({
  take,
  onReadAlong,
  idleHint = 'Tap the mic, wait for GO!, then say it as fast as you can',
  unsupportedHint = 'Speech recognition isn’t supported in this browser — type it below',
}: {
  take: Take
  onReadAlong?: () => void
  idleHint?: string
  unsupportedHint?: string
}) {
  const { speech, mic, lock, arming, live, showGo, startListening } = take
  return (
    <>
      <div className="relative mx-auto mt-8 h-64 w-64">
        {arming && (
          <Lottie
            animationData={pulse}
            loop
            className="absolute inset-0 h-full w-full"
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
            <motion.div
              key="go"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1.15, opacity: 1 }}
              exit={{ scale: 1.6, opacity: 0 }}
              className="pointer-events-none absolute inset-0 z-10 grid place-items-center font-display text-5xl font-extrabold text-lime hit-glow"
            >
              GO!
            </motion.div>
          )}
        </AnimatePresence>
        <motion.button
          whileTap={{ scale: 0.92 }}
          whileHover={{ scale: 1.05 }}
          disabled={!speech.supported || arming || (lock.blocked && !live)}
          onClick={live ? speech.stop : () => void startListening()}
          aria-label={live ? 'Stop' : 'Start speaking'}
          className={`absolute inset-[72px] grid place-items-center rounded-full text-3xl shadow-xl disabled:cursor-wait ${live ? 'bg-pink text-pink-foreground shadow-pink/40' : 'bg-primary text-primary-foreground shadow-primary/40'} ${arming ? 'opacity-70' : ''}`}
        >
          {live ? '⏹' : arming ? '…' : '🎤'}
        </motion.button>
      </div>

      <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
        {arming
          ? 'Getting your mic ready… wait for GO!'
          : live
            ? speech.transcript
              ? 'Keep going — I’ll stop when you finish'
              : 'Listening… say it now'
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
      {live && speech.transcript && (
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
          “{speech.transcript}”
        </p>
      )}
    </>
  )
}
