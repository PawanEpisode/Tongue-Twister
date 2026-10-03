import { Cloud, CloudOff, Laptop } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { usePreferences } from '#/lib/preferences'
import type { SyncState } from '#/lib/preferences'

const COPY: Record<
  SyncState,
  { text: string; Icon: typeof Cloud; tone: string }
> = {
  local: {
    text: 'Settings are saved on this device.',
    Icon: Laptop,
    tone: 'text-muted-foreground',
  },
  synced: {
    text: 'Settings are saved to your account.',
    Icon: Cloud,
    tone: 'text-lime',
  },
  error: {
    text: 'Couldn’t reach the server. Your changes are kept on this device and will sync when it’s back.',
    Icon: CloudOff,
    tone: 'text-pink',
  },
}

/** One note for the whole settings page (not one per card) on where settings are saved. */
export default function PreferenceSyncNote() {
  const { sync, retry } = usePreferences()
  const { text, Icon, tone } = COPY[sync]
  return (
    <p
      role="status"
      aria-live="polite"
      className={`mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${tone}`}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {text}
      {sync === 'error' && (
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      )}
    </p>
  )
}
