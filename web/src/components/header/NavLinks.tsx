import { Link, useRouterState } from '@tanstack/react-router'
import { Check, Menu } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { revealInScroller } from '#/components/ui/scroll-row'
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

function currentDestination(items: Destination[], pathname: string) {
  return (
    [...items]
      .reverse()
      .find(
        (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
      ) ?? items[0]
  )
}

/** Phone header: one menu, instead of a row that has to be scrolled. */
export function MobileNav() {
  const items = useDestinations()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const current = currentDestination(items, pathname)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="size-11 rounded-full p-0 lg:hidden"
          aria-label={`Navigation, ${current.label}`}
        >
          <Menu className="size-5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {items.map((item) => (
          <DropdownMenuItem key={item.to} asChild>
            <Link
              to={item.to}
              className="justify-between"
              aria-current={item.to === current.to ? 'page' : undefined}
            >
              {item.label}
              {item.to === current.to && (
                <Check className="size-4" aria-hidden />
              )}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Segmented destinations. Centered on large screens, where the row fits. */
export function NavPill() {
  const items = useDestinations()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const pill = useRef<HTMLDivElement>(null)

  useEffect(() => {
    revealInScroller(pill.current, '[aria-current="page"]')
  }, [pathname, items.length])

  return (
    <div
      ref={pill}
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-border/70 bg-foreground/[0.04] p-1 text-sm text-muted-foreground"
    >
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="whitespace-nowrap rounded-full px-2.5 py-1.5 font-medium transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center sm:px-3"
          activeProps={{ className: 'bg-card text-foreground shadow-sm' }}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}
