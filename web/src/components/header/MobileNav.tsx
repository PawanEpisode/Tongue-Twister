import { Link, useRouterState } from '@tanstack/react-router'
import { Check, Menu } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { currentDestination, useDestinations } from './destinations'

/** Phone header: one menu, instead of a row that has to be scrolled. */
export default function MobileNav() {
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
