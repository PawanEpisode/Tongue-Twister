import { Link } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { ErrorState, Skeleton } from '#/components/feedback'
import { ActivityCard } from '#/components/progress/ActivityCard'
import { AchievementsSection } from '#/components/progress/AchievementsSection'
import { ProgressStrip } from '#/components/progress/ProgressStrip'
import { Button } from '#/components/ui/button'
import { useDeletionState } from '#/lib/account/useDeletion'
import { useMe } from '#/lib/useMe'
import ProfileHeader from './ProfileHeader'
import ProfileTimeline from './ProfileTimeline'
import RecentAttempts from './RecentAttempts'
import StarredPreview from './StarredPreview'

/** Your profile: identity, progress, activity, achievements, starred and recent attempts. Signed-in only. */
export default function ProfilePage() {
  const me = useMe()
  const deletion = useDeletionState()

  if (me.isPending)
    return (
      <div
        className="mx-auto max-w-4xl space-y-5"
        aria-busy
        aria-label="Loading your profile"
      >
        <Skeleton className="h-44 w-full rounded-3xl" />
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    )
  if (me.isError)
    return (
      <ErrorState
        title="Couldn’t load your profile"
        error={me.error}
        onRetry={() => void me.refetch()}
      />
    )

  return (
    <div className="mx-auto max-w-4xl space-y-8 text-left">
      {deletion.pending && (
        <p
          role="status"
          className="rounded-2xl border border-pink/40 p-3 text-sm text-muted-foreground"
        >
          Your account is scheduled for deletion, so editing is paused.
        </p>
      )}
      <ProfileHeader me={me.data} locked={deletion.pending} />
      <ProgressStrip />
      <ActivityCard />
      <AchievementsSection />
      <ProfileTimeline />
      <StarredPreview />
      <RecentAttempts />
      <div className="flex justify-center">
        <Button asChild variant="outline">
          <Link to="/account">
            <Settings className="size-4" aria-hidden />
            Account &amp; settings
          </Link>
        </Button>
      </div>
    </div>
  )
}
