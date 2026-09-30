import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import type { DisplayStyle } from '#/lib/api'
import { PREFERENCE_RANGES } from '#/lib/preferences'
import { MAX_WPM, MIN_WPM } from '#/lib/readAlong/timeline'
import { cn } from '#/lib/utils'

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
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
        <Button
          type="button"
          variant="outline"
          className="px-3 py-2"
          onClick={() => h.onWpm(v.wpm - WPM_STEP)}
          aria-label="Slower"
        >
          −
        </Button>
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
        <Button
          type="button"
          variant="outline"
          className="px-3 py-2"
          onClick={() => h.onWpm(v.wpm + WPM_STEP)}
          aria-label="Faster"
        >
          +
        </Button>
        <span className="w-20 text-sm tabular-nums text-muted-foreground">
          {v.wpm} WPM
        </span>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {PRESETS.map(([name, wpm]) => (
          <Button
            key={name}
            type="button"
            variant="outline"
            className={cn('px-3 py-2', v.wpm === wpm && 'border-primary')}
            onClick={() => h.onWpm(wpm)}
          >
            {name}
          </Button>
        ))}
        <span className="mx-1 w-px bg-border" />
        {STYLES.map(([key, label]) => (
          <Button
            key={key}
            type="button"
            variant="outline"
            aria-pressed={v.style === key}
            className={cn(
              'px-3 py-2',
              v.style === key && 'border-primary bg-primary/20',
            )}
            onClick={() => h.onStyle(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      <details className="glass rounded-2xl p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Settings
        </summary>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {NUMBERS.map(({ key, label, range, step, slider, needs }) => (
            <Field key={key} label={label}>
              {slider ? (
                <input
                  type="range"
                  min={PREFERENCE_RANGES[range][0]}
                  max={PREFERENCE_RANGES[range][1]}
                  step={step}
                  value={v.numbers[key]}
                  disabled={!!needs && !v.toggles[needs]}
                  onChange={(e) => h.onNumber(key, Number(e.target.value))}
                  className="accent-brand"
                />
              ) : (
                <Input
                  type="number"
                  min={PREFERENCE_RANGES[range][0]}
                  max={PREFERENCE_RANGES[range][1]}
                  step={step}
                  value={v.numbers[key]}
                  disabled={!!needs && !v.toggles[needs]}
                  onChange={(e) => h.onNumber(key, Number(e.target.value))}
                  className="w-16 rounded-lg px-2 py-1"
                />
              )}
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
                className="max-w-44 rounded-lg border border-input bg-card px-2 py-1"
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
