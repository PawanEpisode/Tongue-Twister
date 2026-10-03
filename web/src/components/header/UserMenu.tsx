import { Link } from '@tanstack/react-router'
import { BarChart3, LogOut, Settings, UserRound } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import Avatar from '#/components/profile/Avatar'
import { useAuth } from '#/lib/auth'
import { useIdentity } from '#/lib/profile/useIdentity'
import { signOut } from '#/lib/supabase'

/** Name, account, stats, and sign out — so the bar does not end in a stray button. */
export function UserMenu() {
  const { session } = useAuth()
  const identity = useIdentity()
  if (!session || !identity) return null
  const { name, avatar, email } = identity
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="grid size-11 place-items-center overflow-hidden rounded-full outline-none hover:ring-2 hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={`Account menu for ${name}`}
        >
          <Avatar view={avatar} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-semibold">{name}</p>
          {email && (
            <p className="truncate text-xs text-muted-foreground">{email}</p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/profile">
            <UserRound className="size-4" aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/account">
            <Settings className="size-4" aria-hidden />
            Account &amp; settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/stats">
            <BarChart3 className="size-4" aria-hidden />
            Stats
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="size-4" aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
