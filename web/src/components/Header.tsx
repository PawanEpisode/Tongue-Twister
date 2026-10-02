import { Suspense, lazy } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import PendingDeletionBanner from '#/components/account/PendingDeletionBanner'
import { BrandLink } from '#/components/brand/BrandMark'
import { NavPill } from '#/components/header/NavLinks'
import { ProgressChip } from '#/components/header/ProgressChip'
import ThemeMenu from '#/components/ThemeMenu'
import { Button } from '#/components/ui/button'
import { ScrollRow } from '#/components/ui/scroll-row'
import { useAuth } from '#/lib/auth'

// Signed-in only, and it pulls in the dropdown-menu primitives: keep it out of the first-load bundle.
const MobileNav = lazy(() => import('#/components/header/MobileNav'))

const UserMenu = lazy(() =>
  import('#/components/header/UserMenu').then((mod) => ({
    default: mod.UserMenu,
  })),
)

export default function Header() {
  const { session, loading } = useAuth()
  const here = useRouterState({ select: (s) => s.location.href })

  return (
    <header className="sticky top-0 z-30">
      <div className="border-b border-border/60 bg-background/75 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center px-4 sm:px-5">
          <div className="order-1 flex h-16 items-center">
            <BrandLink />
          </div>
          <nav
            aria-label="Main"
            className="hidden lg:order-2 lg:flex lg:flex-1 lg:justify-center lg:px-3"
          >
            <ScrollRow className="lg:w-max">
              <NavPill />
            </ScrollRow>
          </nav>
          <div className="order-2 ml-auto flex h-16 items-center gap-1.5 sm:gap-2 lg:order-3 lg:ml-0">
            {session && <ProgressChip />}
            <ThemeMenu />
            {loading ? (
              <span
                className="h-9 w-24 animate-pulse rounded-full bg-card"
                aria-hidden
              />
            ) : session ? (
              <Suspense
                fallback={
                  <span
                    className="size-9 animate-pulse rounded-full bg-card"
                    aria-hidden
                  />
                }
              >
                <UserMenu />
              </Suspense>
            ) : (
              <Button asChild size="sm">
                <Link to="/login" search={{ redirect: here }}>
                  Sign in
                </Link>
              </Button>
            )}
            <Suspense
              fallback={
                <span
                  className="size-11 rounded-full border border-border lg:hidden"
                  aria-hidden
                />
              }
            >
              <MobileNav />
            </Suspense>
          </div>
        </div>
      </div>
      <PendingDeletionBanner />
    </header>
  )
}
