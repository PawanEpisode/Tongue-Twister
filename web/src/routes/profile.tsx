import { Link, createFileRoute, useRouterState } from '@tanstack/react-router'
import { PracticeSkeleton } from '#/components/feedback'
import ProfilePage from '#/components/profile/ProfilePage'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/lib/auth'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/profile')({
  head: () =>
    seo({
      title: 'Your profile | Twister',
      description: 'Your progress, achievements and starred twisters.',
      path: '/profile',
      noindex: true,
    }),
  component: ProfileRoute,
})

function ProfileRoute() {
  const { session, loading } = useAuth()
  const here = useRouterState({ select: (s) => s.location.href })
  if (loading) return <PracticeSkeleton />
  if (!session)
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-2xl font-bold">Your profile</h1>
        <p className="mt-2 text-muted-foreground">
          Sign in to see your progress, achievements and starred twisters.
        </p>
        <Button asChild className="mt-6 px-6 py-3">
          <Link to="/login" search={{ redirect: here }}>
            Sign in
          </Link>
        </Button>
      </div>
    )
  return <ProfilePage />
}
