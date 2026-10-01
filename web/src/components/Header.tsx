import { Link, useRouterState } from '@tanstack/react-router'
import { BarChart3, Flame, Star, Tornado, UserRound } from 'lucide-react'
import PendingDeletionBanner from '#/components/account/PendingDeletionBanner'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/lib/auth'
import { signOut } from '#/lib/supabase'
import ThemeMenu from '#/components/ThemeMenu'
import { useFlag } from '#/lib/flags'
import { useSummary } from '#/lib/progress/useSummary'
import { useMe } from '#/lib/useMe'

export default function Header() {
  const { session, loading } = useAuth()
  const recordCloud = useFlag('record_cloud')
  const generate = useFlag('generate_twister')
  const here = useRouterState({ select: (s) => s.location.href })
  const { data: me } = useMe()
  // The summary knows the *effective* streak (0 once lapsed); the profile's stored value can be stale.
  const { data: summary } = useSummary()
  const meta = (session?.user.user_metadata ?? {}) as {
    full_name?: string
    name?: string
    avatar_url?: string
  }
  const name =
    meta.full_name ?? meta.name ?? session?.user.email?.split('@')[0] ?? 'You'

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-3">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 font-display text-xl font-extrabold tracking-tight"
        >
          <span className="text-gradient">Twister</span>
          <Tornado className="size-5 text-brand" aria-hidden />
        </Link>
        <nav className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <ThemeMenu />
          <Link
            to="/twisters"
            className="hover:text-foreground"
            activeProps={{ className: 'text-foreground' }}
          >
            Browse
          </Link>
          {loading ? (
            <span
              className="h-8 w-24 animate-pulse rounded-full bg-card"
              aria-hidden
            />
          ) : session ? (
            <>
              <Link
                to="/practice"
                className="hover:text-foreground"
                activeProps={{ className: 'text-foreground' }}
              >
                Practice
              </Link>
              {recordCloud && (
                <Link
                  to="/recordings"
                  className="hover:text-foreground"
                  activeProps={{ className: 'text-foreground' }}
                >
                  Recordings
                </Link>
              )}
              {generate && (
                <Link
                  to="/generate"
                  className="hover:text-foreground"
                  activeProps={{ className: 'text-foreground' }}
                >
                  Make one
                </Link>
              )}
              {generate && (
                <Link
                  to="/my-twisters"
                  className="hover:text-foreground"
                  activeProps={{ className: 'text-foreground' }}
                >
                  My twisters
                </Link>
              )}
              <Link
                to="/stats"
                className="inline-flex items-center gap-1 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:items-center"
                activeProps={{ className: 'text-foreground' }}
              >
                <BarChart3 className="size-4" aria-hidden />
                Stats
              </Link>
              <Link
                to="/favorites"
                className="inline-flex items-center gap-1 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:items-center"
                activeProps={{ className: 'text-foreground' }}
              >
                <Star className="size-4" aria-hidden />
                Favourites
              </Link>
              <Link
                to="/account"
                className="inline-flex items-center gap-1 hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:items-center"
                activeProps={{ className: 'text-foreground' }}
              >
                <UserRound className="size-4" aria-hidden />
                Account
              </Link>
              {me && (
                <Link
                  to="/stats"
                  aria-label={`${summary?.current_streak ?? me.current_streak}-day streak, level ${summary?.level ?? me.level}, ${summary?.xp ?? me.xp} XP. Open your stats.`}
                  className="hidden items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs hover:text-foreground sm:inline-flex"
                >
                  <Flame className="size-3.5 text-pink" aria-hidden />
                  {summary?.current_streak ?? me.current_streak} · Lv{' '}
                  {summary?.level ?? me.level} · {summary?.xp ?? me.xp} XP
                </Link>
              )}
              <span className="flex items-center gap-2 text-foreground">
                {meta.avatar_url ? (
                  <img
                    src={meta.avatar_url}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-7 w-7 rounded-full"
                  />
                ) : (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                    {name[0]?.toUpperCase()}
                  </span>
                )}
                <span className="hidden max-w-32 truncate md:inline">
                  {name}
                </span>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void signOut()}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Button asChild size="sm">
              <Link to="/login" search={{ redirect: here }}>
                Sign in
              </Link>
            </Button>
          )}
        </nav>
      </div>
      <PendingDeletionBanner />
    </header>
  )
}
