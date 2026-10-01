import { Link, createFileRoute, useRouterState } from '@tanstack/react-router'
import { PracticeSkeleton } from '#/components/feedback'
import AccountPage from '#/components/account/AccountPage'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/lib/auth'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/account')({
  head: () =>
    seo({
      title: 'Your account | Twister',
      description: 'Your settings, your data, and account deletion.',
      path: '/account',
      noindex: true,
    }),
  component: AccountRoute,
})

function AccountRoute() {
  const { session, loading } = useAuth()
  const here = useRouterState({ select: (s) => s.location.href })
  if (loading) return <PracticeSkeleton />
  if (!session)
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-bold">Your account</h1>
        <p className="mt-2 text-muted-foreground">
          Sign in to manage your settings and your data.
        </p>
        <Button asChild className="mt-6 px-6 py-3">
          <Link to="/login" search={{ redirect: here }}>
            Sign in
          </Link>
        </Button>
      </div>
    )
  return <AccountPage />
}
