import type { SettingGroup } from '#/lib/settings/schema'
import { usePreferences } from '#/lib/preferences'
import PreferenceField from './PreferenceField'

/** One settings card body: the group's fields. */
export default function PreferenceGroup({
  group,
  disabled,
}: {
  group: SettingGroup
  disabled?: boolean
}) {
  const { prefs, update, ready } = usePreferences()
  if (!ready)
    return (
      <div aria-busy aria-label={`Loading ${group.title}`} className="h-24" />
    )
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-5 border-0 p-0">
      {group.fields.map((field) => (
        <PreferenceField
          key={'key' in field ? field.key : field.type}
          field={field}
          prefs={prefs}
          update={update}
          disabled={disabled}
        />
      ))}
    </fieldset>
  )
}
