import type { PREFERENCE_RANGES } from '#/lib/preferences'
import type { Preferences } from '#/lib/api'

type KeysOf<T> = {
  [K in keyof Preferences]-?: Preferences[K] extends T ? K : never
}[keyof Preferences]

export type BooleanKey = KeysOf<boolean>
export type RangeKey = Exclude<keyof typeof PREFERENCE_RANGES, 'wpm'>
export type SelectKey = 'default_mode' | 'display_style' | 'accent_lang'

type Described = { label: string; description: string }

export type ToggleField = Described & { type: 'toggle'; key: BooleanKey }
export type SelectField = Described & {
  type: 'select'
  key: SelectKey
  options: { value: string; label: string }[]
}
export type RangeField = Described & {
  type: 'range'
  key: RangeKey
  step: number
  /** How the current value reads next to the slider. */
  unit?: string
  /** Shown for 0 when 0 means "off". */
  zeroLabel?: string
}
/** A number that can be left on automatic (`null`), like words-per-minute. */
export type AutoRangeField = Described & {
  type: 'auto-range'
  key: 'wpm'
  step: number
  unit: string
}
/** Lives on this device first (the ThemeProvider) and syncs through ThemeSync. */
export type ThemeField = Described & { type: 'theme' }

export type SettingField =
  ToggleField | SelectField | RangeField | AutoRangeField | ThemeField

export type SettingGroup = {
  id: string
  title: string
  fields: readonly SettingField[]
}

/**
 * Every preference shown in the settings hub. Add a setting = add a field here (and the API column);
 * the hub renders it, saves it, and keeps it in step with the practice screens.
 */
export const SETTING_GROUPS: readonly SettingGroup[] = [
  {
    id: 'appearance',
    title: 'Appearance',
    fields: [
      {
        type: 'theme',
        label: 'Theme',
        description: 'Follows you to every device you sign in on.',
      },
      {
        type: 'range',
        key: 'font_scale',
        label: 'Text size',
        description: 'How large twisters appear while you practise.',
        step: 0.1,
        unit: '×',
      },
      {
        type: 'toggle',
        key: 'confetti',
        label: 'Celebrations',
        description: 'Confetti when you do well.',
      },
    ],
  },
  {
    id: 'accessibility',
    title: 'Accessibility',
    fields: [
      {
        type: 'toggle',
        key: 'dyslexia_font',
        label: 'Dyslexia-friendly font',
        description: 'A typeface with more distinct letter shapes.',
      },
      {
        type: 'toggle',
        key: 'high_contrast',
        label: 'High contrast',
        description: 'Stronger text and borders.',
      },
      {
        type: 'toggle',
        key: 'reduce_motion',
        label: 'Reduce motion',
        description: 'Fewer animations and transitions.',
      },
      {
        type: 'toggle',
        key: 'mirror_text',
        label: 'Mirror text',
        description: 'Flip the twister horizontally, for a teleprompter.',
      },
    ],
  },
  {
    id: 'practice',
    title: 'Practice defaults',
    fields: [
      {
        type: 'select',
        key: 'default_mode',
        label: 'Start in',
        description: 'The mode a twister opens in.',
        options: [
          { value: 'speak_score', label: 'Speak & Score' },
          { value: 'read_along', label: 'Read along' },
          { value: 'record', label: 'Record' },
        ],
      },
      {
        type: 'select',
        key: 'accent_lang',
        label: 'Accent',
        description: 'Used for listening and speech recognition.',
        options: [
          { value: 'en-US', label: 'English (US)' },
          { value: 'en-GB', label: 'English (UK)' },
          { value: 'en-IN', label: 'English (India)' },
          { value: 'en-AU', label: 'English (Australia)' },
        ],
      },
      {
        type: 'range',
        key: 'daily_goal_attempts',
        label: 'Daily goal',
        description: 'Attempts to aim for each day. Shown on your profile.',
        step: 1,
        unit: 'attempts',
        zeroLabel: 'No goal',
      },
      {
        type: 'range',
        key: 'countdown_s',
        label: 'Countdown',
        description: 'Seconds before recording starts.',
        step: 1,
        unit: 's',
        zeroLabel: 'Off',
      },
      {
        type: 'range',
        key: 'loop_count',
        label: 'Repeat',
        description: 'How many times a twister loops (0 keeps going).',
        step: 1,
        unit: '×',
        zeroLabel: 'Until I stop',
      },
    ],
  },
  {
    id: 'read-along',
    title: 'Read along',
    fields: [
      {
        type: 'select',
        key: 'display_style',
        label: 'Display',
        description: 'How the words are shown as they play.',
        options: [
          { value: 'word', label: 'One word at a time' },
          { value: 'line', label: 'Line by line' },
          { value: 'scroll', label: 'Scrolling text' },
        ],
      },
      {
        type: 'auto-range',
        key: 'wpm',
        label: 'Pace',
        description: 'Automatic follows each twister’s difficulty.',
        step: 5,
        unit: 'wpm',
      },
      {
        type: 'toggle',
        key: 'punctuation_pauses',
        label: 'Pause at punctuation',
        description: 'A beat at commas and full stops.',
      },
      {
        type: 'toggle',
        key: 'listen_first',
        label: 'Listen first',
        description: 'Hear a model reading before you try.',
      },
      {
        type: 'range',
        key: 'threshold_pct',
        label: 'Reading line position',
        description: 'How far down the screen the current word sits.',
        step: 5,
        unit: '%',
      },
      {
        type: 'range',
        key: 'tts_rate',
        label: 'Model voice speed',
        description: 'How fast the model reads.',
        step: 0.05,
        unit: '×',
      },
      {
        type: 'toggle',
        key: 'metronome',
        label: 'Metronome',
        description: 'A steady beat to keep time with.',
      },
      {
        type: 'range',
        key: 'metronome_volume',
        label: 'Metronome volume',
        description: 'Only used while the metronome is on.',
        step: 0.05,
      },
    ],
  },
]
