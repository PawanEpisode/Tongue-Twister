import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy, useState } from 'react'
import { AuthProvider } from '#/lib/auth'
import AttemptSync from '#/components/AttemptSync'
import GuestSync from '#/components/GuestSync'
import Header from '#/components/Header'
import MotionProvider from '#/components/MotionProvider'
import ObservabilityInit from '#/components/ObservabilityInit'
import { AchievementToaster } from '#/components/progress/AchievementToaster'
import TimezoneSync from '#/components/progress/TimezoneSync'
import ThemeSync from '#/components/ThemeSync'
import UploadSync from '#/components/UploadSync'
import { GateProvider } from '#/lib/gate/useGate'
import { hasMemberHint, readCookieHeader } from '#/lib/public/hint'
import {
  AudienceProvider,
  MemberHintSync,
  useAudience,
  usePublicSite,
} from '#/lib/public/audience'
import { PreferencesProvider } from '#/lib/preferences'
import { DEFAULT_DESCRIPTION, SITE_NAME, SITE_URL, seo } from '#/lib/seo'
import { ThemeProvider, THEME_COLORS, themeBootScript } from '#/lib/theme'
import appCss from '../styles.css?url'

// Signed-out chrome only: members never download any of it.
// Runs once right after sign-in, so it is fetched only for members.
const DemoClaim = lazy(() => import('#/components/public/DemoClaim'))
const PublicHeader = lazy(() => import('#/components/public/PublicHeader'))
const GuestChrome = lazy(() => import('#/components/public/GuestChrome'))

/** Pages where the marketing footer would be noise: sign-in flows and dev tools. */
const NO_FOOTER = /^\/(login|reset-password|auth|dev)(\/|$)/
/** Pages members see the public footer on too. */
const MEMBER_FOOTER = /^\/(privacy|terms|about)(\/|$)/

export const Route = createRootRoute({
  // What the page looks like depends on the `tw_m` cookie, so caches must key on it.
  headers: () => ({ Vary: 'Cookie' }),
  beforeLoad: async () => ({
    memberHint: hasMemberHint(await readCookieHeader()),
  }),
  head: () => {
    // No canonical here: every page sets its own through `seo()` (the home page included), and an
    // inherited home canonical would tell search engines that every other page is a copy of `/`.
    const base = seo()
    return {
      meta: [
        { charSet: 'utf-8' },
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, viewport-fit=cover',
        },
        { name: 'theme-color', content: THEME_COLORS.dark },
        { name: 'application-name', content: 'Twister' },
        { name: 'apple-mobile-web-app-title', content: 'Twister' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        {
          name: 'apple-mobile-web-app-status-bar-style',
          content: 'black-translucent',
        },
        ...base.meta,
      ],
      links: [
        { rel: 'stylesheet', href: appCss },
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        {
          rel: 'icon',
          href: '/favicon-32.png',
          type: 'image/png',
          sizes: '32x32',
        },
        {
          rel: 'icon',
          href: '/favicon-16.png',
          type: 'image/png',
          sizes: '16x16',
        },
        { rel: 'shortcut icon', href: '/favicon.ico' },
        {
          rel: 'apple-touch-icon',
          href: '/apple-touch-icon.png',
          sizes: '180x180',
        },
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'preconnect',
          href: 'https://fonts.gstatic.com',
          crossOrigin: 'anonymous',
        },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600&display=swap',
        },
      ],
      scripts: [
        {
          type: 'application/ld+json',
          children: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: SITE_NAME,
            url: SITE_URL,
            description: DEFAULT_DESCRIPTION,
            applicationCategory: 'EducationalApplication',
            operatingSystem: 'Any (modern browser)',
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          }),
        },
      ],
    }
  },
  shellComponent: RootDocument,
  component: RootLayout,
})

function Chrome() {
  const audience = useAudience()
  const publicSite = usePublicSite()
  const pathname = useRouterState({ select: (st) => st.location.pathname })
  const guest = audience === 'guest' && publicSite
  const landing = guest && pathname === '/'
  const footer =
    (guest && !NO_FOOTER.test(pathname)) ||
    (audience === 'member' && MEMBER_FOOTER.test(pathname))
  return (
    <>
      <MemberHintSync />
      {audience === 'member' && (
        <Suspense fallback={null}>
          <DemoClaim />
        </Suspense>
      )}
      {landing ? (
        <Suspense fallback={<div className="h-16" aria-hidden />}>
          <PublicHeader />
        </Suspense>
      ) : (
        <Header />
      )}
      <MotionProvider>
        <main className="mx-auto max-w-6xl px-4 pt-6 pb-[max(6rem,env(safe-area-inset-bottom))] sm:px-5 sm:pt-8">
          <Outlet />
        </main>
        {(guest || footer) && (
          <Suspense fallback={null}>
            <GuestChrome guest={guest} footer={footer} />
          </Suspense>
        )}
        <AchievementToaster />
      </MotionProvider>
    </>
  )
}

function RootLayout() {
  const { memberHint } = Route.useRouteContext()
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  )
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <AuthProvider>
          <PreferencesProvider>
            <GuestSync />
            <AttemptSync />
            <UploadSync />
            <TimezoneSync />
            <ThemeSync />
            <ObservabilityInit />
            <AudienceProvider memberHint={memberHint}>
              <GateProvider>
                <Chrome />
              </GateProvider>
            </AudienceProvider>
          </PreferencesProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
