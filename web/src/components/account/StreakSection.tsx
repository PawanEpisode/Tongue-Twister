import type { AccountSectionProps } from './types'
import ProfileSwitch from './ProfileSwitch'

export default function StreakSection({ me, locked }: AccountSectionProps) {
  return (
    <fieldset disabled={locked} className="min-w-0 space-y-2 border-0 p-0">
      <ProfileSwitch
        me={me}
        field="night_owl"
        label="Night owl"
        description="Count 00:00–02:59 for the previous day, so practising after midnight keeps yesterday’s streak going."
        disabled={locked}
      />
      <p className="text-xs text-muted-foreground">
        This applies from now on. Days you’ve already practised don’t change.
      </p>
    </fieldset>
  )
}
