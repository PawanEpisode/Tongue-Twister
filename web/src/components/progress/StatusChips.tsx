import { Chip } from '#/components/ui/chip'
import { ScrollRow } from '#/components/ui/scroll-row'
import type { BrowseStatus } from '#/lib/api'
import { BROWSE_STATUSES, STATUS_LABELS } from '#/lib/progress/browseParams'

/** Filter Browse by how far along you are. Signed-in only (the API needs to know who you are). */
export function StatusChips({
  value,
  onChange,
}: {
  value?: BrowseStatus
  onChange: (status: BrowseStatus | undefined) => void
}) {
  return (
    <ScrollRow wrap role="group" aria-label="Your progress">
      <Chip on={!value} onClick={() => onChange(undefined)}>
        Any progress
      </Chip>
      {BROWSE_STATUSES.map((s) => (
        <Chip key={s} on={value === s} onClick={() => onChange(s)}>
          {STATUS_LABELS[s]}
        </Chip>
      ))}
    </ScrollRow>
  )
}
