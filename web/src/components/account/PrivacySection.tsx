import { setAnalyticsOptOut } from '#/lib/observability/analytics'
import { useAnalyticsConsent } from '#/lib/observability/consent'
import SettingSwitch from './SettingSwitch'

/** The analytics opt-out. Stored on this device only. A browser Do-Not-Track setting already wins. */
export default function PrivacySection() {
  const { optedOut, dnt } = useAnalyticsConsent()
  const on = !optedOut && !dnt
  return (
    <div className="space-y-3">
      <SettingSwitch
        label="Share anonymous usage statistics"
        description="Counts of things like practice sessions started, so we can see what to improve. No cookies, no recordings, no transcripts, no personal details, and never sold."
        checked={on}
        disabled={dnt}
        status="idle"
        onChange={(next) => setAnalyticsOptOut(!next)}
      />
      {dnt && (
        <p className="text-xs text-muted-foreground">
          Your browser’s Do Not Track setting is on, so nothing is shared.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        This choice is saved on this device only. Crash reports (no account
        details, no text you practised) are separate and help us fix bugs.
      </p>
    </div>
  )
}
