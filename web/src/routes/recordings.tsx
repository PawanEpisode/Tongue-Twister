import { Link, createFileRoute, useRouterState } from '@tanstack/react-router'
import { Film, Share2, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ErrorState, friendlyError } from '#/components/feedback'
import AnalyseControl from '#/components/practice/record/AnalyseControl'
import ExpiringBanner from '#/components/practice/record/ExpiringBanner'
import PublicNameField from '#/components/practice/record/PublicNameField'
import ReviewPlayer from '#/components/practice/record/ReviewPlayer'
import ShareDialog from '#/components/practice/record/ShareDialog'
import StorageMeter from '#/components/practice/record/StorageMeter'
import UploadStatusChip from '#/components/practice/record/UploadStatusChip'
import { Button } from '#/components/ui/button'
import { DeleteDialogWrapper } from '#/components/ui/delete-dialog'
import { twisterSlug } from '#/lib/api'
import type { RecordingSummary } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { useFlag, useFlags } from '#/lib/flags'
import { canShare } from '#/lib/record/cloudGate'
import { markersFromApi } from '#/lib/record/markers'
import { chooseCaptions } from '#/lib/record/review'
import { formatBytes, formatClock } from '#/lib/record/quality'
import {
  usePlanLimits,
  useRecording,
  useRecordingMutations,
  useRecordingsList,
  useStablePlayback,
  useStorage,
} from '#/lib/record/useRecordings'
import { useUploads } from '#/lib/record/useUploads'
import { seo } from '#/lib/seo'
import { useMe } from '#/lib/useMe'

export const Route = createFileRoute('/recordings')({
  head: () =>
    seo({
      title: 'Your recordings | Twister',
      description: 'Recordings you saved to your account.',
      path: '/recordings',
      noindex: true,
    }),
  component: RecordingsPage,
})

function RecordingsPage() {
  const { session, loading } = useAuth()
  const flags = useFlags()
  const enabled = useFlag('record_cloud')
  const here = useRouterState({ select: (s) => s.location.href })
  const me = useMe().data
  const { shareMaxDays } = usePlanLimits()
  const list = useRecordingsList({ enabled })
  const storage = useStorage(enabled)
  const uploads = useUploads()
  const mutations = useRecordingMutations()
  const [openId, setOpenId] = useState<string | null>(null)
  const [shareId, setShareId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<RecordingSummary | null>(null)
  const [undo, setUndo] = useState<RecordingSummary | null>(null)

  const detail = useRecording(openId)
  const playback = useStablePlayback(detail.data)
  const captions = chooseCaptions({
    captionsUrl: detail.data?.captions_url,
    captionsSource: detail.data?.captions_source,
    localCues: null,
  })
  const markers = useMemo(
    () =>
      detail.data
        ? markersFromApi(detail.data.words, detail.data.duration_ms ?? 0)
        : [],
    [detail.data],
  )

  if (loading) return null
  if (!enabled)
    return (
      <p className="py-16 text-center text-muted-foreground">
        Saving recordings to your account isn’t available yet.
      </p>
    )
  if (!session)
    return (
      <div className="glass mx-auto mt-10 max-w-md rounded-2xl p-8 text-center">
        <h1 className="font-display text-2xl font-bold">Your recordings</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in to see the recordings you saved.
        </p>
        <Button asChild className="mt-4">
          <Link to="/login" search={{ redirect: here }}>
            Sign in
          </Link>
        </Button>
      </div>
    )
  if (list.isError)
    return (
      <ErrorState
        title="Couldn’t load your recordings"
        error={list.error}
        onRetry={() => void list.refetch()}
      />
    )

  const items = list.data?.results ?? []
  const inFlight = uploads.jobs.filter((j) => j.status !== 'done')
  const sharing = canShare({ flags, signedIn: true, ageBand: me?.age_band })

  return (
    <div className="mx-auto max-w-4xl space-y-6 text-left">
      <header className="space-y-3">
        <h1 className="font-display text-3xl font-bold">Your recordings</h1>
        {storage.data && <StorageMeter quota={storage.data} />}
        {sharing && <PublicNameField />}
      </header>

      {storage.data && (
        <ExpiringBanner items={storage.data.expiring_soon ?? []} />
      )}

      {undo && (
        <p
          role="status"
          className="glass flex items-center justify-between gap-3 rounded-xl px-4 py-2 text-sm"
        >
          <span>Deleted “{undo.title}”.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              mutations.restore.mutate(undo.id, {
                onSuccess: () => setUndo(null),
              })
            }
          >
            <Undo2 className="mr-1 size-4" aria-hidden />
            Undo
          </Button>
        </p>
      )}

      {inFlight.length > 0 && (
        <section
          aria-label="Uploading"
          className="glass space-y-3 rounded-2xl p-4"
        >
          {inFlight.map((j) => (
            <div key={j.id}>
              <p className="mb-1 text-sm font-semibold">{j.title}</p>
              <UploadStatusChip
                job={j}
                onRetry={(id) => uploads.manager?.retry(id)}
              />
            </div>
          ))}
        </section>
      )}

      {list.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-2xl bg-card" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground">
          <Film className="mx-auto mb-3 size-8" aria-hidden />
          <p>
            Nothing here yet. Record a twister and choose “Save to my account”.
          </p>
          <Button asChild className="mt-4">
            <Link to="/twisters">Pick a twister</Link>
          </Button>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((r) => (
            <li key={r.id} className="glass overflow-hidden rounded-2xl">
              <button
                type="button"
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                aria-expanded={openId === r.id}
                className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="aspect-video bg-black">
                  {r.thumbnail_url ? (
                    <img
                      src={r.thumbnail_url}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="grid size-full place-items-center text-muted-foreground">
                      <Film className="size-8" aria-hidden />
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <p className="truncate font-semibold">{r.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString()}
                    {r.duration_ms != null &&
                      ` · ${formatClock(r.duration_ms)}`}
                    {r.size_bytes != null && ` · ${formatBytes(r.size_bytes)}`}
                    {r.status === 'processing' && ' · processing'}
                    {r.status === 'failed' && ' · failed'}
                  </p>
                  {r.expires_at && (
                    <p className="text-xs text-muted-foreground">
                      Kept until {new Date(r.expires_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </button>
              <div className="flex gap-2 border-t border-border p-2">
                {sharing && r.status === 'ready' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShareId(r.id)}
                  >
                    <Share2 className="mr-1 size-4" aria-hidden />
                    Share
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="hover:border-pink"
                  onClick={() => setDeleting(r)}
                >
                  <Trash2 className="mr-1 size-4" aria-hidden />
                  Delete
                </Button>
                <Button asChild size="sm" variant="ghost" className="ml-auto">
                  <Link
                    to="/twisters/$slug"
                    params={{ slug: twisterSlug(r.twister) }}
                  >
                    Practise it
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {openId && (
        <section aria-label="Recording" className="glass rounded-2xl p-4">
          {detail.isPending ? (
            <div
              className="aspect-video animate-pulse rounded-xl bg-card"
              aria-hidden
            />
          ) : detail.isError ? (
            <p role="alert" className="text-pink">
              {friendlyError(detail.error)}
            </p>
          ) : playback ? (
            <div className="space-y-3">
              <h2 className="font-display text-xl font-bold">
                {detail.data.title}
              </h2>
              <ReviewPlayer
                src={playback.url}
                durationMs={detail.data.duration_ms ?? 0}
                markers={markers}
                captionsSrc={captions.kind === 'server' ? captions.url : null}
                label={detail.data.title}
              />
              <AnalyseControl
                recordingId={detail.data.id}
                recordingStatus={detail.data.status}
                analysis={detail.data.analysis}
              />
            </div>
          ) : detail.data.status === 'processing' ||
            detail.data.status === 'uploaded' ? (
            <div role="status">
              <div
                className="aspect-video animate-pulse rounded-xl bg-card motion-reduce:animate-none"
                aria-hidden
              />
              <p className="mt-2 text-center text-sm text-muted-foreground">
                Preparing your video…
              </p>
            </div>
          ) : (
            <p className="text-muted-foreground">
              This recording isn’t ready to watch yet.
            </p>
          )}
        </section>
      )}

      {shareId && (
        <ShareDialog
          recordingId={shareId}
          open
          maxDays={shareMaxDays}
          onClose={() => setShareId(null)}
        />
      )}
      <DeleteDialogWrapper
        open={!!deleting}
        onOpenChange={(next) => {
          if (!next) setDeleting(null)
        }}
        title="Delete this recording?"
        description="You can undo this right after."
        preview={deleting?.title}
        pending={mutations.remove.isPending}
        onConfirm={() => {
          const target = deleting
          if (!target) return
          mutations.remove.mutate(target.id, {
            onSuccess: () => {
              setUndo(target)
              if (openId === target.id) setOpenId(null)
            },
            onSettled: () => setDeleting(null),
          })
        }}
      />
    </div>
  )
}
