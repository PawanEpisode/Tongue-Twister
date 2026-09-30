import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/lib/auth'
import { api } from '#/lib/api'
import { supabase } from '#/lib/supabase'
import ThemeMenu from '#/components/ThemeMenu'

export default function Header() {
  const { session, loading } = useAuth()
  const here = useRouterState({ select: (s) => s.location.href })
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    enabled: !!session,
  })
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
          className="font-display text-xl font-extrabold tracking-tight"
        >
          <span className="text-gradient">Twister</span>
          <span className="ml-1">🌀</span>
        </Link>
        <nav className="flex items-center gap-3 text-sm text-muted-foreground">
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
              {me && (
                <span className="hidden rounded-full bg-card px-3 py-1 text-xs sm:inline">
                  🔥 {me.current_streak} · Lv {me.level} · {me.xp} XP
                </span>
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
                onClick={() => supabase?.auth.signOut()}
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
    </header>
  )
}
