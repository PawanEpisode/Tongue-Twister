import type { Profile } from '#/lib/api'
import { useProfileSetting } from '#/lib/account/useProfileSetting'
import SettingSwitch from './SettingSwitch'

/** A boolean profile setting, saved optimistically. One component for every switch on the page. */
export default function ProfileSwitch({
  me,
  field,
  label,
  description,
  disabled,
}: {
  me: Profile
  field: 'hide_from_boards' | 'night_owl'
  label: string
  description: string
  disabled?: boolean
}) {
  const { save, status } = useProfileSetting(field)
  return (
    <SettingSwitch
      label={label}
      description={description}
      checked={me[field] ?? false}
      disabled={disabled}
      status={status}
      onChange={save}
    />
  )
}
