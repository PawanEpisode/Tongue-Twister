import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '#/lib/auth'
import { api } from '#/lib/api'
import { supabase } from '#/lib/supabase'

export default function Header() {
  const { session, enabled } = useAuth()
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    enabled: !!session,
  })
  return (
    <header className="sticky top-0 z-30 border-b border-line/60 bg-ink/70 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
        <Link
          to="/"
          className="font-display text-xl font-extrabold tracking-tight"
        >
          <span className="text-gradient">Twister</span>
          <span className="ml-1">🌀</span>
        </Link>
        <nav className="flex items-center gap-5 text-sm text-white/70">
          <Link
            to="/twisters"
            className="hover:text-white"
            activeProps={{ className: 'text-white' }}
          >
            Browse
          </Link>
          {me && (
            <span className="hidden sm:inline rounded-full bg-panel px-3 py-1 text-xs">
              🔥 {me.current_streak} · Lv {me.level} · {me.xp} XP
            </span>
          )}
          {enabled &&
            (session ? (
              <button
                className="rounded-full border border-line px-3 py-1 hover:border-brand"
                onClick={() => supabase?.auth.signOut()}
              >
                Sign out
              </button>
            ) : (
              <Link
                to="/login"
                className="rounded-full bg-brand px-4 py-1.5 font-semibold text-white hover:opacity-90"
              >
                Sign in
              </Link>
            ))}
        </nav>
      </div>
    </header>
  )
}
