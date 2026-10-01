import { useId, useMemo } from 'react'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { nativeSelectClass } from '#/components/ui/select'
import { saveStatusText } from '#/lib/account/optimistic'
import { timezoneOptions } from '#/lib/account/timezones'
import { useProfileSetting } from '#/lib/account/useProfileSetting'
import type { Profile } from '#/lib/api'
import { browserTimeZone } from '#/lib/progress/timezone'

/** The zone that decides where a streak day ends. The browser's zone is one tap away. */
export default function TimezoneField({
  me,
  disabled,
}: {
  me: Profile
  disabled?: boolean
}) {
  const id = useId()
  const { save, status } = useProfileSetting('timezone')
  const current = me.timezone ?? 'UTC'
  const browser = browserTimeZone()
  const options = useMemo(
    () => timezoneOptions(current, browser),
    [current, browser],
  )

  return (
    <div className="space-y-1 text-left text-sm">
      <Label htmlFor={id} className="block font-semibold">
        Time zone
      </Label>
      <div className="flex flex-wrap gap-2">
        <select
          id={id}
          value={current}
          disabled={disabled}
          onChange={(e) => save(e.target.value)}
          className={nativeSelectClass}
        >
          {options.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !browser || browser === current}
          onClick={() => browser && save(browser)}
        >
          Use my browser’s time zone
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Your streak days start and end at midnight in this zone.
      </p>
      <p
        role="status"
        aria-live="polite"
        className={`min-h-4 text-xs ${status === 'failed' ? 'text-pink' : 'text-lime'}`}
      >
        {saveStatusText(status)}
      </p>
    </div>
  )
}
