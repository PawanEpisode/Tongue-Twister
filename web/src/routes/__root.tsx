import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { AuthProvider } from '#/lib/auth'
import Header from '#/components/Header'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Twister — Master tongue twisters' },
      {
        name: 'description',
        content:
          'Practice classic and modern tongue twisters with live speech feedback, scores, streaks and levels.',
      },
      { name: 'theme-color', content: '#0b0a16' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
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
  }),
  shellComponent: RootDocument,
  component: RootLayout,
})

function RootLayout() {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  )
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Header />
        <main className="mx-auto max-w-6xl px-5 pb-24 pt-8">
          <Outlet />
        </main>
      </AuthProvider>
    </QueryClientProvider>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
