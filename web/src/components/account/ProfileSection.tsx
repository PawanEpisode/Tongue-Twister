import PublicNameField from '#/components/practice/record/PublicNameField'
import type { AccountSectionProps } from './types'
import ProfileSwitch from './ProfileSwitch'
import TimezoneField from './TimezoneField'

export default function ProfileSection({ me, locked }: AccountSectionProps) {
  return (
    <fieldset disabled={locked} className="min-w-0 space-y-5 border-0 p-0">
      <p className="text-sm">
        <span className="text-muted-foreground">Display name </span>
        <b>{me.display_name}</b>
        <span className="block text-xs text-muted-foreground">
          This comes from your sign-in and is only shown to you.
        </span>
      </p>
      <PublicNameField />
      <TimezoneField me={me} disabled={locked} />
      <ProfileSwitch
        me={me}
        field="hide_from_boards"
        label="Hide me from leaderboards"
        description="Your scores stay yours: you won’t appear on weekly or twister boards."
        disabled={locked}
      />
    </fieldset>
  )
}
