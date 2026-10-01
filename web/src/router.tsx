import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { ErrorState, NotFound, PracticeSkeleton } from '#/components/feedback'
import { parseSearch, stringifySearch } from '#/lib/searchParams'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    // Clean URLs: `?difficulty=1`, not `?difficulty=%221%22` (see lib/searchParams.ts).
    parseSearch,
    stringifySearch,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // App-wide safety nets: any route that throws or 404s gets a friendly screen instead of a blank page.
    defaultErrorComponent: ({ error, reset }) => (
      <ErrorState
        error={error}
        onRetry={() => {
          reset()
          void router.invalidate()
        }}
      />
    ),
    defaultNotFoundComponent: NotFound,
    defaultPendingComponent: PracticeSkeleton,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
