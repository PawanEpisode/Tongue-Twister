import { useId } from 'react'
import SettingSwitch from '#/components/account/SettingSwitch'
import { SelectField } from '#/components/ui/select'
import type { Preferences } from '#/lib/api'
import { PREFERENCE_RANGES } from '#/lib/preferences'
import { formatRangeValue } from '#/lib/settings/format'
import type {
  AutoRangeField,
  RangeField,
  SettingField,
} from '#/lib/settings/schema'
import { THEME_OPTIONS, useTheme } from '#/lib/theme'
import type { ThemePreference } from '#/lib/theme'
import { cn } from '#/lib/utils'

type Props = {
  field: SettingField
  prefs: Preferences
  update: (patch: Partial<Preferences>) => void
  disabled?: boolean
}

const THEME_LABEL: Record<ThemePreference, string> = {
  system: 'Automatic (day/night)',
  light: 'Light',
  dark: 'Dark',
  reading: 'Reading (warm paper)',
}

function Slider({
  field,
  value,
  onChange,
  disabled,
  trailing,
}: {
  field: RangeField | AutoRangeField
  value: number
  onChange: (next: number) => void
  disabled?: boolean
  trailing?: string
}) {
  const id = useId()
  const [min, max] = PREFERENCE_RANGES[field.key]
  return (
    <div className="space-y-1 text-left text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="font-semibold">
          {field.label}
        </label>
        <output
          htmlFor={id}
          className="text-xs tabular-nums text-muted-foreground"
        >
          {trailing ?? formatRangeValue(field, value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={field.step}
        value={value}
        disabled={disabled}
        aria-describedby={`${id}-d`}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 w-full accent-primary disabled:opacity-40 pointer-coarse:h-8"
      />
      <p id={`${id}-d`} className="text-xs text-muted-foreground">
        {field.description}
      </p>
    </div>
  )
}

/** Renders one schema field against the shared preferences. Saving and syncing are the provider's job. */
export default function PreferenceField({
  field,
  prefs,
  update,
  disabled,
}: Props) {
  const theme = useTheme()
  switch (field.type) {
    case 'toggle':
      return (
        <SettingSwitch
          label={field.label}
          description={field.description}
          checked={prefs[field.key]}
          disabled={disabled}
          status="idle"
          onChange={(next) => update({ [field.key]: next })}
        />
      )
    case 'select':
      return (
        <SelectField
          label={field.label}
          hint={field.description}
          value={prefs[field.key]}
          options={field.options}
          disabled={disabled}
          onValueChange={(value) => update({ [field.key]: value })}
        />
      )
    case 'theme':
      return (
        <SelectField
          label={field.label}
          hint={field.description}
          value={theme.preference}
          options={THEME_OPTIONS.map((value) => ({
            value,
            label: THEME_LABEL[value],
          }))}
          disabled={disabled}
          onValueChange={(value) =>
            theme.setPreference(value as ThemePreference)
          }
        />
      )
    case 'range':
      return (
        <Slider
          field={field}
          value={prefs[field.key]}
          disabled={disabled}
          onChange={(next) => update({ [field.key]: next })}
        />
      )
    case 'auto-range': {
      const [min, max] = PREFERENCE_RANGES[field.key]
      const auto = prefs.wpm === null
      return (
        <div className="space-y-2">
          <div className={cn(auto && 'opacity-60')}>
            <Slider
              field={field}
              value={
                prefs.wpm ??
                Math.round((min + max) / 2 / field.step) * field.step
              }
              disabled={disabled || auto}
              trailing={auto ? 'Automatic' : undefined}
              onChange={(next) => update({ wpm: next })}
            />
          </div>
          <SettingSwitch
            label="Choose pace automatically"
            description="Match each twister’s difficulty."
            checked={auto}
            disabled={disabled}
            status="idle"
            onChange={(next) =>
              update({
                wpm: next
                  ? null
                  : Math.round((min + max) / 2 / field.step) * field.step,
              })
            }
          />
        </div>
      )
    }
  }
}
