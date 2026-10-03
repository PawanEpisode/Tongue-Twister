import { ErrorState, Skeleton } from '#/components/feedback'
import { Card } from '#/components/ui/card'
import { PageTitle } from '#/components/ui/page-title'
import { useDeletionState } from '#/lib/account/useDeletion'
import { useFlags } from '#/lib/flags'
import { useMe } from '#/lib/useMe'
import { cn } from '#/lib/utils'
import PreferenceSyncNote from '#/components/settings/PreferenceSyncNote'
import { ACCOUNT_SECTIONS } from './sections'
import { visibleSections } from './types'

function AccountSkeleton({ count }: { count: number }) {
  return (
    <div className="space-y-5" aria-busy aria-label="Loading your account">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-40 w-full rounded-2xl" />
      ))}
    </div>
  )
}

/** The settings page body: the sections, composed from the registry. Signed-in callers only. */
export default function AccountPage() {
  const me = useMe()
  const deletion = useDeletionState()
  const sections = visibleSections(ACCOUNT_SECTIONS, useFlags())

  return (
    <div className="mx-auto max-w-2xl text-left">
      <PageTitle>Account &amp; settings</PageTitle>
      <PreferenceSyncNote />
      {deletion.pending && (
        <p className="mt-2 text-sm text-muted-foreground">
          Settings are paused while your account is scheduled for deletion.
        </p>
      )}
      <div className="mt-6 space-y-5">
        {me.isPending ? (
          <AccountSkeleton count={sections.length} />
        ) : me.isError ? (
          <ErrorState
            title="Couldn’t load your account"
            error={me.error}
            onRetry={() => void me.refetch()}
          />
        ) : (
          sections.map(({ id, title, tone, Component }) => (
            <Card
              key={id}
              asChild
              variant="glass"
              className={cn(
                'rounded-2xl p-4 sm:p-6',
                tone === 'danger' && 'border border-pink/40',
              )}
            >
              <section id={id} aria-labelledby={`${id}-h`}>
                <h2 id={`${id}-h`} className="mb-4 text-xl font-bold">
                  {title}
                </h2>
                <Component me={me.data} locked={deletion.pending} />
              </section>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
