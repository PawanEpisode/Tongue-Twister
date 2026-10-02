import { useAuth } from '#/lib/auth'
import { useFlag } from '#/lib/flags'

export type Destination = {
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
export function useDestinations(): Destination[] {
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

export function currentDestination(items: Destination[], pathname: string) {
  return (
    [...items]
      .reverse()
      .find(
        (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
      ) ?? items[0]
  )
}
