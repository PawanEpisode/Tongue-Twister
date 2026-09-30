import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Download, Flag } from 'lucide-react'
import { useRef, useState } from 'react'
import { ErrorState, PracticeSkeleton } from '#/components/feedback'
import ReviewPlayer from '#/components/practice/record/ReviewPlayer'
import { Button } from '#/components/ui/button'
import { Dialog } from '#/components/ui/dialog'
import { ApiError, api } from '#/lib/api'
import type { ReportReason } from '#/lib/api'
import { formatClock } from '#/lib/record/quality'
import { seo } from '#/lib/seo'

export const Route = createFileRoute('/r/$token')({
  // No loader: the page is fetched in the browser so a share link never puts a recording into cached HTML.
  head: () => {
    const base = seo({
      title: 'A Twister recording',
      description: 'Someone shared a tongue twister recording with you.',
      path: '/r',
      noindex: true,
    })
    // The link is a secret: don't hand it to other sites through the Referer header.
    return {
      ...base,
      meta: [...base.meta, { name: 'referrer', content: 'no-referrer' }],
    }
  },
  component: SharedRecording,
})

const REASONS: { value: ReportReason; label: string }[] = [
  { value: 'abuse', label: 'Abusive or harassing' },
  { value: 'sexual', label: 'Sexual or inappropriate content' },
  { value: 'minor', label: 'Involves a child in an unsafe way' },
  { value: 'privacy', label: 'Shows me or someone I know without permission' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Something else' },
]

function Gone({ title, body }: { title: string; body: string }) {
  return (
    <div className="glass mx-auto mt-10 max-w-md rounded-2xl p-8 text-center">
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <Button asChild className="mt-5">
        <Link to="/twisters">Try a tongue twister</Link>
      </Button>
    </div>
  )
}

function SharedRecording() {
  const { token } = Route.useParams()
  const [reporting, setReporting] = useState(false)
  const q = useQuery({
    queryKey: ['public-recording', token],
    queryFn: () => api.publicRecording(token),
    retry: (n, err) => !(err instanceof ApiError) && n < 1,
    staleTime: 5 * 60_000,
  })

  if (q.isPending) return <PracticeSkeleton />
  if (q.isError) {
    const status = q.error instanceof ApiError ? q.error.status : 0
    if (status === 410)
      return (
        <Gone
          title="This link has expired"
          body="The owner set it to expire, or turned it off. Ask them for a new one."
        />
      )
    if (status === 404)
      return (
        <Gone
          title="We can’t find this recording"
          body="The link may be mistyped, or the recording was deleted."
        />
      )
    return (
      <ErrorState
        title="Couldn’t load this recording"
        error={q.error}
        onRetry={() => void q.refetch()}
      />
    )
  }

  const r = q.data
  const owner = r.owner.display_name
  return (
    <div className="mx-auto max-w-3xl space-y-5 text-left">
      <header>
        <h1 className="font-display text-2xl font-bold">{r.title}</h1>
        <p className="text-sm text-muted-foreground">
          {owner ? `Shared by ${owner}` : 'Shared with you'}
          {r.duration_ms != null && ` · ${formatClock(r.duration_ms)}`}
          {r.score != null && ` · score ${Math.round(r.score)}`}
        </p>
        <blockquote className="mt-3 border-l-2 border-primary pl-3 font-display text-lg">
          {r.twister.text}
        </blockquote>
      </header>

      <ReviewPlayer
        src={r.playback.url}
        durationMs={r.duration_ms ?? 0}
        captionsSrc={r.captions_url}
        hotkeys
        label={r.title}
      />

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Button asChild variant="outline">
          <a href={r.playback.url} download>
            <Download className="mr-1.5 size-4" aria-hidden />
            Download to watch
          </a>
        </Button>
        <Button asChild>
          <Link to="/twisters/$slug" params={{ slug: r.twister.slug }}>
            Try this twister yourself
          </Link>
        </Button>
        <Button variant="ghost" onClick={() => setReporting(true)}>
          <Flag className="mr-1.5 size-4" aria-hidden />
          Report
        </Button>
      </div>
      <ReportDialog
        token={token}
        open={reporting}
        onClose={() => setReporting(false)}
      />
    </div>
  )
}

function ReportDialog({
  token,
  open,
  onClose,
}: {
  token: string
  open: boolean
  onClose: () => void
}) {
  const [reason, setReason] = useState<ReportReason>('abuse')
  const [details, setDetails] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  )
  const first = useRef<HTMLSelectElement>(null)

  const send = async () => {
    setState('sending')
    try {
      await api.reportRecording(token, {
        reason,
        details: details.trim().slice(0, 500),
      })
      setState('sent')
    } catch {
      setState('error')
    }
  }
  const close = () => {
    setState('idle')
    setDetails('')
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Report this recording"
      initialFocus={first}
    >
      {state === 'sent' ? (
        <div className="space-y-4 text-sm">
          <p role="status">Thank you. We’ll take a look.</p>
          <div className="flex justify-end">
            <Button onClick={close}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-left text-sm">
          <label className="block">
            <span className="mb-1 block font-semibold">What’s wrong?</span>
            <select
              ref={first}
              value={reason}
              onChange={(e) => setReason(e.target.value as ReportReason)}
              className="w-full rounded-xl border border-input bg-card px-3 py-2"
            >
              {REASONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block font-semibold">Details (optional)</span>
            <textarea
              value={details}
              maxLength={500}
              rows={3}
              onChange={(e) => setDetails(e.target.value)}
              className="w-full rounded-xl border border-input bg-card px-3 py-2"
            />
          </label>
          {state === 'error' && (
            <p role="alert" className="text-pink">
              We couldn’t send that. Please try again.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={state === 'sending'} onClick={() => void send()}>
              {state === 'sending' ? 'Sending…' : 'Send report'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
