import { useId } from 'react'
import { friendlyError } from '#/components/feedback'
import {
  useRemindersEnabled,
  useReminders,
  useSaveReminders,
} from '#/lib/reminders/hooks'
import SettingSwitch from './SettingSwitch'
import type { AccountSectionProps } from './types'

const hourLabel = (h: number) =>
  new Date(2000, 0, 1, h).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })

/** One daily email at the learner's chosen local hour, only if they haven't practised yet. Flag `reminders`. */
export default function RemindersSection({ locked }: AccountSectionProps) {
  const flagOn = useRemindersEnabled()
  const prefs = useReminders(flagOn)
  const { save, status } = useSaveReminders()
  const id = useId()

  if (!flagOn)
    return (
      <p className="text-sm text-muted-foreground">
        Email reminders aren’t available yet.
      </p>
    )
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
        <label htmlFor={id} className="block font-semibold">
          Send it around
        </label>
        <select
          id={id}
          value={p.hour_local}
          disabled={locked || !p.enabled}
          onChange={(e) => save({ ...p, hour_local: Number(e.target.value) })}
          className="rounded-xl border border-input bg-card px-3 py-2 disabled:opacity-50"
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {hourLabel(h)}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          In your time zone (set under Profile). Sent to the email on your
          account.
        </p>
      </div>
    </fieldset>
  )
}
