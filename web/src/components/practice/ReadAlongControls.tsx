import type { ReactNode } from 'react'
import type { DisplayStyle } from '#/lib/api'
import { PREFERENCE_RANGES } from '#/lib/preferences'
import { MAX_WPM, MIN_WPM } from '#/lib/readAlong/timeline'

const PRESETS = [
  ['Slow', 70],
  ['Normal', 110],
  ['Fast', 150],
  ['Pro', 190],
] as const
const STYLES: [DisplayStyle, string][] = [
  ['word', 'Word'],
  ['line', 'Line'],
  ['scroll', 'Scroll'],
]
const WPM_STEP = 5

export const TOGGLES = [
  ['punctuationPauses', 'Pause at punctuation'],
  ['ladder', 'Speed ladder (+10 WPM per loop)'],
  ['metronome', 'Metronome tick per word'],
  ['listenFirst', 'Listen first, then read'],
  ['mirror', 'Mirror text'],
  ['dyslexia', 'Dyslexia-friendly font'],
  ['contrast', 'High-contrast highlight'],
] as const
export type ToggleKey = (typeof TOGGLES)[number][0]

export type NumberKey =
  'loops' | 'fontScale' | 'thresholdPct' | 'countdownS' | 'metronomeVolume'
const NUMBERS: {
  key: NumberKey
  label: string
  range: keyof typeof PREFERENCE_RANGES
  step: number
  slider: boolean
  /** Only meaningful while this toggle is on. */
  needs?: ToggleKey
}[] = [
  {
    key: 'loops',
    label: 'Loops (0 = ∞)',
    range: 'loop_count',
    step: 1,
    slider: false,
  },
  {
    key: 'countdownS',
    label: 'Countdown (s)',
    range: 'countdown_s',
    step: 1,
    slider: false,
  },
  {
    key: 'metronomeVolume',
    label: 'Metronome volume',
    range: 'metronome_volume',
    step: 0.05,
    slider: true,
    needs: 'metronome',
  },
  {
    key: 'fontScale',
    label: 'Text size',
    range: 'font_scale',
    step: 0.1,
    slider: true,
  },
  {
    key: 'thresholdPct',
    label: 'Reading line position',
    range: 'threshold_pct',
    step: 5,
    slider: true,
  },
]

export type ControlValues = {
  wpm: number
  style: DisplayStyle
  numbers: Record<NumberKey, number>
  toggles: Record<ToggleKey, boolean>
  voiceURI: string
  /** Empty when the browser has no English voice (Listen first is then unavailable). */
  voices: { voiceURI: string; name: string }[]
}
export type ControlHandlers = {
  onWpm: (n: number) => void
  onStyle: (s: DisplayStyle) => void
  onToggle: (key: ToggleKey) => void
  onNumber: (key: NumberKey, n: number) => void
  onVoice: (voiceURI: string) => void
}

const btn =
  'rounded-xl border border-line px-3 py-2 text-sm font-semibold hover:border-brand disabled:opacity-40'
const input = 'rounded-lg bg-panel px-2 py-1'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-white/70">
      {label}
      {children}
    </label>
  )
}

/** Speed, style and the settings panel. Transport buttons live in ReadAlongTransport. */
export default function ReadAlongControls({
  v,
  h,
}: {
  v: ControlValues
  h: ControlHandlers
}) {
  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      <div
        className="flex flex-wrap items-center justify-center gap-2"
        role="group"
        aria-label="Speed"
      >
        <button
          className={btn}
          onClick={() => h.onWpm(v.wpm - WPM_STEP)}
          aria-label="Slower"
        >
          −
        </button>
        <input
          type="range"
          min={MIN_WPM}
          max={MAX_WPM}
          step={WPM_STEP}
          value={v.wpm}
          onChange={(e) => h.onWpm(Number(e.target.value))}
          aria-label="Words per minute"
          className="w-40 accent-brand sm:w-64"
        />
        <button
          className={btn}
          onClick={() => h.onWpm(v.wpm + WPM_STEP)}
          aria-label="Faster"
        >
          +
        </button>
        <span className="w-20 text-sm tabular-nums text-white/70">
          {v.wpm} WPM
        </span>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {PRESETS.map(([name, wpm]) => (
          <button
            key={name}
            className={`${btn} ${v.wpm === wpm ? 'border-brand' : ''}`}
            onClick={() => h.onWpm(wpm)}
          >
            {name}
          </button>
        ))}
        <span className="mx-1 w-px bg-line" />
        {STYLES.map(([key, label]) => (
          <button
            key={key}
            aria-pressed={v.style === key}
            className={`${btn} ${v.style === key ? 'border-brand bg-brand/20' : ''}`}
            onClick={() => h.onStyle(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <details className="glass rounded-2xl p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Settings
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {NUMBERS.map(({ key, label, range, step, slider, needs }) => (
            <Field key={key} label={label}>
              <input
                type={slider ? 'range' : 'number'}
                min={PREFERENCE_RANGES[range][0]}
                max={PREFERENCE_RANGES[range][1]}
                step={step}
                value={v.numbers[key]}
                disabled={!!needs && !v.toggles[needs]}
                onChange={(e) => h.onNumber(key, Number(e.target.value))}
                className={slider ? 'accent-brand' : `w-16 ${input}`}
              />
            </Field>
          ))}
          {TOGGLES.map(([key, label]) => (
            <Field key={key} label={label}>
              <input
                type="checkbox"
                checked={v.toggles[key]}
                disabled={key === 'listenFirst' && !v.voices.length}
                onChange={() => h.onToggle(key)}
                className="size-5 accent-brand"
              />
            </Field>
          ))}
          {v.voices.length > 0 && (
            <Field label="Model voice">
              <select
                value={v.voiceURI}
                onChange={(e) => h.onVoice(e.target.value)}
                className={`max-w-44 ${input}`}
              >
                <option value="">Recommended</option>
                {v.voices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </details>
    </div>
  )
}
