import { Link } from '@tanstack/react-router'
import { BarChart3, ChevronDown, LogOut, UserRound } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { useAuth } from '#/lib/auth'
import { signOut } from '#/lib/supabase'

function identityOf(
  session: NonNullable<ReturnType<typeof useAuth>['session']>,
) {
  const meta = (session.user.user_metadata ?? {}) as {
    full_name?: string
    name?: string
    avatar_url?: string
  }
  const name =
    meta.full_name ?? meta.name ?? session.user.email?.split('@')[0] ?? 'You'
  return { name, avatarUrl: meta.avatar_url, email: session.user.email }
}

function Avatar({ name, url }: { name: string; url?: string }) {
  if (url) {
    return (
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        className="size-7 rounded-full object-cover"
      />
    )
  }
  return (
    <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
      {name[0]?.toUpperCase()}
    </span>
  )
}

/** Name, account, stats, and sign out — so the bar does not end in a stray button. */
export function UserMenu() {
  const { session } = useAuth()
  if (!session) return null
  const { name, avatarUrl, email } = identityOf(session)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/90 py-1 pr-1.5 pl-1 text-sm font-medium text-foreground outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring/50 md:pr-2.5 pointer-coarse:min-h-11"
          aria-label={`Account menu for ${name}`}
        >
          <Avatar name={name} url={avatarUrl} />
          <span className="hidden max-w-28 truncate md:inline">{name}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
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
          <Link to="/account">
            <UserRound className="size-4" aria-hidden />
            Account
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
