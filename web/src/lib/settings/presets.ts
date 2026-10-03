import { DEFAULT_PREFERENCES } from '#/lib/preferences'
import type { Preferences } from '#/lib/api'

export type SettingPreset = {
  id: string
  label: string
  description: string
  /** Only comfort and assist settings: a preset never touches the theme, the goal, or anything that scores. */
  values: Partial<Preferences>
}

export const SETTING_PRESETS: readonly SettingPreset[] = [
  {
    id: 'easy-reading',
    label: 'Easy reading',
    description:
      'Larger text, a friendlier font, high contrast and calmer motion.',
    values: {
      font_scale: 1.4,
      dyslexia_font: true,
      high_contrast: true,
      reduce_motion: true,
      display_style: 'line',
    },
  },
  {
    id: 'gentle-start',
    label: 'Gentle start',
    description:
      'A slow pace, a longer countdown, and a model to listen to first.',
    values: {
      wpm: 90,
      listen_first: true,
      countdown_s: 5,
      punctuation_pauses: true,
      loop_count: 3,
      metronome: false,
    },
  },
  {
    id: 'challenge',
    label: 'Challenge me',
    description: 'A brisk pace and a short countdown, with no model first.',
    values: {
      wpm: 150,
      listen_first: false,
      countdown_s: 1,
      loop_count: 1,
      punctuation_pauses: false,
    },
  },
  {
    id: 'defaults',
    label: 'Reset to defaults',
    description:
      'Put every practice and accessibility setting back to how it started.',
    values: Object.fromEntries(
      Object.entries(DEFAULT_PREFERENCES).filter(
        ([key]) =>
          ![
            'theme',
            'daily_goal_attempts',
            'tts_voice',
            'speed_ladder',
          ].includes(key),
      ),
    ),
  },
]

/** Just the values that would actually change, so applying a preset twice is a no-op. */
export function presetPatch(
  preset: SettingPreset,
  current: Preferences,
): Partial<Preferences> {
  return Object.fromEntries(
    Object.entries(preset.values).filter(
      ([key, value]) =>
        JSON.stringify(current[key as keyof Preferences]) !==
        JSON.stringify(value),
    ),
  )
}

/** The patch that puts back what `patch` replaced. */
export function undoPatch(
  patch: Partial<Preferences>,
  before: Preferences,
): Partial<Preferences> {
  return Object.fromEntries(
    Object.keys(patch).map((key) => [key, before[key as keyof Preferences]]),
  )
}
