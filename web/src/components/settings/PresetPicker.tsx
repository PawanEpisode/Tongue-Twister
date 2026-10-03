import { Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '#/components/ui/button'
import type { Preferences } from '#/lib/api'
import { usePreferences } from '#/lib/preferences'
import { SETTING_PRESETS, presetPatch, undoPatch } from '#/lib/settings/presets'
import type { SettingPreset } from '#/lib/settings/presets'

type Applied = { label: string; undo: Partial<Preferences> }

/** One-tap starting points. Applying one is reversible straight away, so nobody loses their setup. */
export default function PresetPicker({ disabled }: { disabled?: boolean }) {
  const { prefs, update, ready } = usePreferences()
  const [applied, setApplied] = useState<Applied | null>(null)
  if (!ready)
    return <div aria-busy aria-label="Loading presets" className="h-24" />

  const apply = (preset: SettingPreset) => {
    const patch = presetPatch(preset, prefs)
    if (Object.keys(patch).length === 0) {
      setApplied({ label: preset.label, undo: {} })
      return
    }
    update(patch)
    setApplied({ label: preset.label, undo: undoPatch(patch, prefs) })
  }

  return (
    <div className="space-y-3">
      <ul className="grid gap-2 sm:grid-cols-2">
        {SETTING_PRESETS.map((preset) => (
          <li key={preset.id}>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() => apply(preset)}
              className="h-full w-full flex-col items-start gap-0.5 rounded-2xl px-4 py-3 text-left whitespace-normal"
            >
              <span className="font-semibold">{preset.label}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {preset.description}
              </span>
            </Button>
          </li>
        ))}
      </ul>
      <p
        role="status"
        aria-live="polite"
        className="flex min-h-8 flex-wrap items-center gap-2 text-sm"
      >
        {applied &&
          (Object.keys(applied.undo).length === 0 ? (
            <span className="text-muted-foreground">
              Already set up like “{applied.label}”.
            </span>
          ) : (
            <>
              <span className="text-lime">Applied “{applied.label}”.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  update(applied.undo)
                  setApplied(null)
                }}
              >
                <Undo2 className="size-3.5" aria-hidden />
                Undo
              </Button>
            </>
          ))}
      </p>
    </div>
  )
}
