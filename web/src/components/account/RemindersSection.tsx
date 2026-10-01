import { useId } from 'react'
import { friendlyError } from '#/components/feedback'
import { SelectField } from '#/components/ui/select'
import { useReminders, useSaveReminders } from '#/lib/reminders/hooks'
import SettingSwitch from './SettingSwitch'
import type { AccountSectionProps } from './types'

const hourLabel = (h: number) =>
  new Date(2000, 0, 1, h).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

/** One daily email at the learner's chosen local hour, only if they haven't practised yet. Gated by the `reminders` flag in the registry
 * (`sections.tsx`), so it is only rendered while the flag is on. */
export default function RemindersSection({ locked }: AccountSectionProps) {
  const prefs = useReminders()
  const { save, status } = useSaveReminders()
  const id = useId()

  if (prefs.isPending)
    return (
      <p className="text-sm text-muted-foreground" aria-busy>
        Loading…
      </p>
    )
  if (prefs.isError)
    return (
      <p className="text-sm text-pink" role="alert">
        {friendlyError(prefs.error)}
      </p>
    )
  const p = prefs.data
  return (
    <fieldset disabled={locked} className="min-w-0 space-y-3 border-0 p-0">
      <SettingSwitch
        label="Daily practice reminder"
        description="One email a day, only on days you haven’t practised yet. Every email has a one-click unsubscribe link."
        checked={p.enabled}
        disabled={locked}
        status={status}
        onChange={(enabled) => save({ ...p, enabled })}
      />
      <div className="space-y-1 text-sm">
        <SelectField
          id={id}
          label="Send it around"
          labelClassName="font-semibold"
          value={String(p.hour_local)}
          disabled={locked || !p.enabled}
          onValueChange={(hour) => save({ ...p, hour_local: Number(hour) })}
          options={Array.from({ length: 24 }, (_, hour) => ({
            value: String(hour),
            label: hourLabel(hour),
          }))}
        />
        <p className="text-xs text-muted-foreground">
          In your time zone (set under Profile). Sent to the email on your
          account.
        </p>
      </div>
    </fieldset>
  )
}
