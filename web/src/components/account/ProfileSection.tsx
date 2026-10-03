import PublicNameField from '#/components/practice/record/PublicNameField'
import Avatar from '#/components/profile/Avatar'
import ProfileEditDialog from '#/components/profile/ProfileEditDialog'
import { useIdentity } from '#/lib/profile/useIdentity'
import type { AccountSectionProps } from './types'
import ProfileSwitch from './ProfileSwitch'
import TimezoneField from './TimezoneField'

export default function ProfileSection({ me, locked }: AccountSectionProps) {
  const identity = useIdentity()
  if (!identity) return null
  return (
    <fieldset disabled={locked} className="min-w-0 space-y-5 border-0 p-0">
      <div className="flex items-center gap-3">
        <span className="size-12 shrink-0 text-2xl">
          <Avatar view={identity.avatar} />
        </span>
        <p className="min-w-0 flex-1 text-sm">
          <span className="text-muted-foreground">Display name</span>
          <b className="block truncate text-base">{identity.name}</b>
        </p>
        <ProfileEditDialog me={me} disabled={locked} />
      </div>
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
