import { Link } from '@tanstack/react-router'
import { useAuth } from '#/lib/auth'
import { useFlag } from '#/lib/flags'

type Destination = {
  to:
    | '/twisters'
    | '/practice'
    | '/recordings'
    | '/generate'
    | '/my-twisters'
    | '/favorites'
  label: string
}

/** Primary places in the bar. Stats and Account live in the player cluster. */
function useDestinations(): Destination[] {
  const { session } = useAuth()
  const recordCloud = useFlag('record_cloud')
  const generate = useFlag('generate_twister')
  const items: Destination[] = [{ to: '/twisters', label: 'Browse' }]
  if (!session) return items
  items.push({ to: '/practice', label: 'Practice' })
  if (recordCloud) items.push({ to: '/recordings', label: 'Recordings' })
  if (generate) {
    items.push({ to: '/generate', label: 'Make one' })
    items.push({ to: '/my-twisters', label: 'My twisters' })
  }
  items.push({ to: '/favorites', label: 'Favourites' })
  return items
}

/** Segmented destinations. One instance, centered on large screens and scrolled below. */
export function NavPill() {
  const items = useDestinations()
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-foreground/[0.04] p-1 text-sm text-muted-foreground">
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="whitespace-nowrap rounded-full px-3 py-1.5 font-medium transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center"
          activeProps={{ className: 'bg-card text-foreground shadow-sm' }}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}
