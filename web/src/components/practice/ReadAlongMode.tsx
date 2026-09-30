import { useEffect, useMemo, useRef, useState } from 'react'
import type { DisplayStyle, Preferences, Twister } from '#/lib/api'
import { PREFERENCE_RANGES } from '#/lib/preferences'
import {
  buildTimeline,
  clampWpm,
  defaultWpm,
  effectiveLoops,
} from '#/lib/readAlong/timeline'
import { useListenFirst } from '#/lib/readAlong/useListenFirst'
import { useMetronome } from '#/lib/readAlong/useMetronome'
import { useReadAlong } from '#/lib/readAlong/useReadAlong'
import type { RunStats } from '#/lib/readAlong/useReadAlong'
import { useFullscreen } from '#/lib/useFullscreen'
import { useHotkeys } from '#/lib/useHotkeys'
import { usePracticeSession } from '#/lib/usePracticeSession'
import { usePracticeLock } from '#/lib/tabLock'
import ReadAlongControls from './ReadAlongControls'
import type { ControlHandlers, NumberKey, ToggleKey } from './ReadAlongControls'
import ReadAlongStage from './ReadAlongStage'
import ReadAlongSummary from './ReadAlongSummary'
import ReadAlongTransport from './ReadAlongTransport'

const HEARTBEAT_MS = 15_000 // keeps session write volume low (ERD 06a)
const LADDER_STEP = 10
const LADDER_TARGET = 160
const FONT_STEP = 0.1
const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['R', 'Restart'],
  ['← →', 'Back / forward one word'],
  ['↑ ↓', 'Speed ±5 WPM'],
  ['[ ]', 'Text size'],
  ['L', 'Listen to a model reading'],
  ['F', 'Focus mode (fullscreen)'],
  ['M', 'Mirror text'],
  ['?', 'This help'],
]
const TOGGLE_FIELD = {
  punctuationPauses: 'punctuation_pauses',
  mirror: 'mirror_text',
  dyslexia: 'dyslexia_font',
  contrast: 'high_contrast',
  metronome: 'metronome',
  listenFirst: 'listen_first',
} as const
const NUMBER_FIELD = {
  loops: 'loop_count',
  fontScale: 'font_scale',
  thresholdPct: 'threshold_pct',
  countdownS: 'countdown_s',
} as const satisfies Record<NumberKey, keyof typeof PREFERENCE_RANGES>

const clampTo = (key: keyof typeof PREFERENCE_RANGES, n: number) =>
  Math.min(PREFERENCE_RANGES[key][1], Math.max(PREFERENCE_RANGES[key][0], n))

type Props = {
  twister: Twister
  prefs: Preferences
  update: (patch: Partial<Preferences>) => void
  /** Deep-link values (?wpm=&style=) that apply to this visit until the user changes them. */
  overrides: { wpm?: number; style?: DisplayStyle }
  onSwitchMode: () => void
}
type Summary = RunStats & { wpm: number; xp?: number }

export default function ReadAlongMode({
  twister,
  prefs,
  update,
  overrides,
  onSwitchMode,
}: Props) {
  const [touched, setTouched] = useState<{
    wpm?: number
    style?: DisplayStyle
  }>({})
  const [summary, setSummary] = useState<Summary | null>(null)
  const [help, setHelp] = useState(false)
  const [listening, setListening] = useState(false)
  const readAfterListen = useRef(false)
  const focus = useFullscreen<HTMLDivElement>()
  const lock = usePracticeLock()

  const wpm = clampWpm(
    touched.wpm ?? overrides.wpm ?? prefs.wpm ?? defaultWpm(twister.difficulty),
  )
  const style = touched.style ?? overrides.style ?? prefs.display_style
  const ladderOn = !!prefs.speed_ladder.enabled
  const ladderTarget = prefs.speed_ladder.target ?? LADDER_TARGET

  const setWpm = (n: number) => {
    const next = clampWpm(n)
    setTouched((t) => ({ ...t, wpm: next }))
    update({ wpm: next })
  }
  const setStyle = (s: DisplayStyle) => {
    setTouched((t) => ({ ...t, style: s }))
    update({ display_style: s })
  }

  const timeline = useMemo(
    () =>
      buildTimeline(twister.text, wpm, {
        punctuationPauses: prefs.punctuation_pauses,
      }),
    [twister.text, wpm, prefs.punctuation_pauses],
  )

  // engine/tts are referenced lazily inside these callbacks (they run after the first render).
  const session = usePracticeSession(twister.slug, 'read_along', () => {
    const s = engine.getStats()
    return {
      active_ms: Math.round(s.activeMs),
      loops_completed: s.passes,
      passes_completed: s.passes,
    }
  })
  const engine = useReadAlong({
    timeline,
    loops: effectiveLoops(timeline.tokens.length, prefs.loop_count),
    countdownS: prefs.countdown_s,
    onLoopEnd: () => {
      if (ladderOn && wpm < ladderTarget)
        setWpm(
          Math.min(
            ladderTarget,
            wpm + (prefs.speed_ladder.step ?? LADDER_STEP),
          ),
        )
    },
    onComplete: (stats) => {
      if (listening) return // hearing a model is not practice: no summary, no credit
      const avg =
        Math.round(
          ((timeline.tokens.length * stats.passes) /
            Math.max(stats.activeMs / 60_000, 1 / 60)) *
            10,
        ) / 10
      setSummary({ ...stats, wpm: avg }) // show at once; XP joins when the server answers
      void session
        .finish({ avg_wpm: avg })
        .then((r) => r && setSummary((s) => s && { ...s, xp: r.xp_awarded }))
    },
  })
  const { status } = engine
  const running = status === 'running' || status === 'countdown'

  const tts = useListenFirst({
    text: twister.text,
    wpm,
    lang: prefs.accent_lang,
    voiceURI: prefs.tts_voice,
    rateMultiplier: prefs.tts_rate,
    onWord: (i) => engine.seek(i), // boundary events keep the highlight locked to the voice
    onEnd: () => {
      setListening(false)
      if (readAfterListen.current) {
        readAfterListen.current = false
        engine.restart()
        engine.start()
      }
    },
  })
  const metronome = useMetronome({
    enabled: prefs.metronome,
    index: engine.index,
    running: status === 'running',
  })

  const beginListening = () => {
    setListening(true)
    engine.restart()
    engine.start({ skipCountdown: true }) // the timeline is the fallback if the browser sends no word boundaries
    tts.listen()
  }
  const stopListening = () => {
    readAfterListen.current = false
    tts.stop()
    setListening(false)
  }
  const toggleListen = () => {
    if (listening) {
      stopListening()
      engine.restart()
    } else beginListening()
  }

  const start = () => {
    metronome.prime()
    if (status === 'done') {
      session.reset()
      setSummary(null)
    }
    if (
      prefs.listen_first &&
      tts.available &&
      (status === 'idle' || status === 'done') &&
      !listening
    ) {
      readAfterListen.current = true
      return beginListening()
    }
    engine.start()
  }
  const toggle = () => (running ? engine.pause() : start())
  const startFrom = (i: number) => {
    engine.seek(i)
    if (!running) start()
  }

  // Pausing/restarting silences the model voice. Only status is watched: adding
  // `listening` would stop the model the moment it starts, while status is still idle.
  useEffect(() => {
    if (listening && (status === 'paused' || status === 'idle')) stopListening()
  }, [status])

  // One practice session per real run (not for listening).
  useEffect(() => {
    if (running && !listening) session.begin()
  }, [running, listening, session])
  useEffect(() => {
    if (status !== 'running' || listening) return
    const id = setInterval(() => void session.heartbeat(), HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [status, listening, session])

  // Only one tab practises at a time (PRD 01 §8.2).
  useEffect(() => {
    if (running) lock.claim()
    else lock.release()
  }, [running, lock])

  useHotkeys({
    ' ': toggle,
    r: engine.restart,
    l: toggleListen,
    f: focus.toggle,
    ArrowLeft: () => engine.step(-1),
    ArrowRight: () => engine.step(1),
    ArrowUp: () => setWpm(wpm + 5),
    ArrowDown: () => setWpm(wpm - 5),
    '[': () =>
      update({
        font_scale: clampTo(
          'font_scale',
          +(prefs.font_scale - FONT_STEP).toFixed(1),
        ),
      }),
    ']': () =>
      update({
        font_scale: clampTo(
          'font_scale',
          +(prefs.font_scale + FONT_STEP).toFixed(1),
        ),
      }),
    m: () => update({ mirror_text: !prefs.mirror_text }),
    '?': () => setHelp((h) => !h),
  })

  const handlers: ControlHandlers = {
    onWpm: setWpm,
    onStyle: setStyle,
    onToggle: (key: ToggleKey) =>
      key === 'ladder'
        ? update({
            speed_ladder: { ...prefs.speed_ladder, enabled: !ladderOn },
          })
        : update({ [TOGGLE_FIELD[key]]: !prefs[TOGGLE_FIELD[key]] }),
    onNumber: (key, n) =>
      update({ [NUMBER_FIELD[key]]: clampTo(NUMBER_FIELD[key], n) }),
    onVoice: (voiceURI) => update({ tts_voice: voiceURI }),
  }

  const announce =
    status === 'countdown'
      ? `Starting in ${engine.countdown}`
      : ({ done: 'Finished', paused: 'Paused', running: 'Reading', idle: '' }[
          status
        ] ?? '')
  const multiPass = prefs.loop_count !== 1 || timeline.tokens.length <= 4

  return (
    <div
      ref={focus.ref}
      className={focus.active ? 'overflow-auto bg-ink p-6' : ''}
    >
      <div onClick={() => status !== 'done' && toggle()} className="relative">
        <ReadAlongStage
          timeline={timeline}
          index={engine.index}
          style={style}
          look={{
            threshold_pct: prefs.threshold_pct,
            font_scale: prefs.font_scale,
            mirror_text: prefs.mirror_text,
            dyslexia_font: prefs.dyslexia_font,
            high_contrast: prefs.high_contrast,
          }}
          reduceMotion={prefs.reduce_motion}
          degraded={engine.degraded}
          focus={focus.active}
          subscribe={engine.subscribe}
          onSeek={engine.seek}
          onStartFrom={startFrom}
        />
        {status === 'countdown' && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl bg-ink/60 font-display text-7xl font-extrabold text-lime"
          >
            {engine.countdown}
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      {lock.blocked && (
        <p role="status" className="mt-3 text-center text-sm text-pink">
          Practice is active in another tab — finish or pause it there first.
        </p>
      )}
      {engine.degraded && (
        <p role="status" className="mt-3 text-center text-sm text-white/50">
          Smooth scroll turned off to keep up.
        </p>
      )}
      {status === 'paused' && engine.reason !== 'user' && (
        <p role="status" className="mt-3 text-center text-sm text-cyan">
          {engine.reason === 'hidden'
            ? 'Paused because you switched tabs.'
            : 'Paused — your device was asleep.'}{' '}
          Press play to resume.
        </p>
      )}

      {status === 'done' && summary ? (
        <ReadAlongSummary
          {...summary}
          fasterBy={LADDER_STEP}
          onFaster={() => {
            setWpm(wpm + LADDER_STEP)
            start()
          }}
          onAgain={start}
          onSpeak={onSwitchMode}
        />
      ) : (
        <ReadAlongTransport
          status={status}
          index={engine.index}
          wordCount={timeline.tokens.length}
          totalMs={timeline.totalMs}
          wpm={wpm}
          loopLabel={multiPass ? `loop ${engine.loop}` : null}
          listenState={
            !tts.available ? 'unavailable' : listening ? 'speaking' : 'idle'
          }
          focus={{ supported: focus.supported, active: focus.active }}
          onToggle={lock.blocked && !running ? () => undefined : toggle}
          onRestart={engine.restart}
          onStep={engine.step}
          onSeek={engine.seek}
          onListen={toggleListen}
          onFocus={focus.toggle}
          onHelp={() => setHelp((h) => !h)}
        />
      )}
      {help && (
        <dl className="glass mx-auto mt-3 grid max-w-md grid-cols-2 gap-x-6 gap-y-1 rounded-2xl p-4 text-sm">
          {SHORTCUTS.map(([k, d]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-brand">{k}</dt>
              <dd className="text-white/70">{d}</dd>
            </div>
          ))}
        </dl>
      )}

      {!focus.active && (
        <ReadAlongControls
          v={{
            wpm,
            style,
            numbers: {
              loops: prefs.loop_count,
              fontScale: prefs.font_scale,
              thresholdPct: prefs.threshold_pct,
              countdownS: prefs.countdown_s,
            },
            toggles: {
              punctuationPauses: prefs.punctuation_pauses,
              ladder: ladderOn,
              metronome: prefs.metronome,
              listenFirst: prefs.listen_first,
              mirror: prefs.mirror_text,
              dyslexia: prefs.dyslexia_font,
              contrast: prefs.high_contrast,
            },
            voiceURI: prefs.tts_voice,
            voices: tts.voices.map((v) => ({
              voiceURI: v.voiceURI,
              name: v.name,
            })),
          }}
          h={handlers}
        />
      )}
    </div>
  )
}
