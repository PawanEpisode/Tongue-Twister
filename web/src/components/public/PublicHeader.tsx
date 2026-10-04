import { Menu, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { BrandLink } from '#/components/brand/BrandMark'
import ThemeMenu from '#/components/ThemeMenu'
import { Button } from '#/components/ui/button'
import { NAV } from '#/content/landing'
import { useGate } from '#/lib/gate/useGate'
import { track } from '#/lib/observability/analytics'
import { cn } from '#/lib/utils'

/** The landing page's own sticky nav: clear at the top, glass after 24 px, with a scroll-spy on its anchors. */
export default function PublicHeader() {
  const { request } = useGate()
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState<string>('')
  const [menu, setMenu] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const els = NAV.map((n) => document.querySelector(n.href)).filter(
      (e): e is Element => !!e,
    )
    if (!els.length || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) setActive(`#${e.target.id}`)
      },
      { rootMargin: '-45% 0px -50% 0px' },
    )
    els.forEach((e) => io.observe(e))
    return () => io.disconnect()
  }, [])

  const start = () => {
    track('landing_cta_clicked', { where: 'header' })
    request({ intent: 'header_cta', returnTo: '/twisters' })
  }

  return (
    <header className="sticky top-0 z-30">
      <div
        className={cn(
          'border-b pt-[env(safe-area-inset-top)] transition-colors duration-300',
          scrolled
            ? 'border-border/60 bg-background/75 backdrop-blur-xl'
            : 'border-transparent bg-transparent',
        )}
      >
        <div
          className={cn(
            'mx-auto flex max-w-6xl items-center gap-3 px-4 transition-[height] duration-300 sm:px-5',
            scrolled ? 'h-[52px]' : 'h-16',
          )}
        >
          <BrandLink />
          <nav
            aria-label="Sections"
            className="hidden flex-1 justify-center md:flex"
          >
            <ul className="flex items-center gap-1 text-sm">
              {NAV.map((n) => (
                <li key={n.href}>
                  <a
                    href={n.href}
                    aria-current={active === n.href ? 'true' : undefined}
                    className={cn(
                      'rounded-full px-3 py-1.5 font-medium text-muted-foreground transition-colors hover:text-foreground',
                      active === n.href && 'bg-card text-foreground',
                    )}
                  >
                    {n.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <ThemeMenu />
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden sm:inline-flex"
            >
              <Link to="/login" search={{ redirect: '/twisters' }}>
                Sign in
              </Link>
            </Button>
            <Button size="sm" onClick={start}>
              Start free
            </Button>
            <Button
              type="button"
              variant="outline"
              className="size-10 rounded-full p-0 md:hidden"
              aria-label={menu ? 'Close menu' : 'Open menu'}
              aria-expanded={menu}
              onClick={() => setMenu((v) => !v)}
            >
              {menu ? (
                <X className="size-5" aria-hidden />
              ) : (
                <Menu className="size-5" aria-hidden />
              )}
            </Button>
          </div>
        </div>
        {menu && (
          <nav
            aria-label="Sections"
            className="absolute inset-x-0 top-full border-b border-t border-border/60 bg-background px-4 py-3 shadow-lg md:hidden"
          >
            <ul className="flex flex-col">
              {NAV.map((n) => (
                <li key={n.href}>
                  <a
                    href={n.href}
                    onClick={() => setMenu(false)}
                    className="block rounded-lg px-3 py-3 font-medium"
                  >
                    {n.label}
                  </a>
                </li>
              ))}
              <li>
                <Link
                  to="/login"
                  search={{ redirect: '/twisters' }}
                  className="block rounded-lg px-3 py-3 font-medium"
                >
                  Sign in
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </div>
    </header>
  )
}
