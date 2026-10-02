import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { revealInScroller } from '#/components/ui/scroll-row'
import { useDestinations } from './destinations'

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
