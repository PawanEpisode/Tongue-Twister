import { Link, useRouterState } from '@tanstack/react-router'
import {
  CloudUpload,
  Download,
  FileText,
  Mic,
  RotateCcw,
  Share2,
  Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import ResultCard from '#/components/ResultCard'
import { Button } from '#/components/ui/button'
import { Dialog } from '#/components/ui/dialog'
import type { Quota } from '#/lib/api'
import { toVtt } from '#/lib/record/captions'
import type { TakeAnalysis, DeliveryHints } from '#/lib/record/analysis'
import type { SaveAccess } from '#/lib/record/cloudGate'
import { formatBytes, formatClock } from '#/lib/record/quality'
import { downloadName } from '#/lib/record/take'
import type { Take } from '#/lib/record/take'
import { track } from '#/lib/record/telemetry'
import { extensionFor } from '#/lib/record/mime'
import { chooseCaptions } from '#/lib/record/review'
import { useRecording } from '#/lib/record/useRecordings'
import type { UploadJob } from '#/lib/record/uploadManager'
import WordBreakdown from '../WordBreakdown'
import ReviewPlayer from './ReviewPlayer'
import SavedRecordingStatus from './SavedRecordingStatus'
import StorageMeter from './StorageMeter'
import UploadStatusChip from './UploadStatusChip'

/** An object URL that is revoked when the blob changes or the component goes away. */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return setUrl(null)
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}

const ENDED_NOTICE: Partial<Record<Take['endedReason'], string>> = {
  limit: 'You reached your recording time limit, so it stopped there.',
  device:
    'A camera or microphone disconnected, so this take ended early. Everything up to then is saved.',
  error:
    'Something interrupted the recording, so it ended early. Everything up to then is saved.',
  tab_hidden: 'The tab was hidden for too long, so recording stopped.',
}

export type ReviewProps = {
  take: Take
  analysis: TakeAnalysis | null
  hints: DeliveryHints | null
  /** The transcript is still being matched. */
  pending: boolean
  xp?: number
  access: SaveAccess
  canShare: boolean
  defaultTitle: string
  job: UploadJob | undefined
  quota: Quota | undefined
  onDownload: () => void
  onSave: (title: string) => void
  onRetryUpload: (id: string) => void
  onShare: (recordingId: string) => void
  onReRecord: () => void
  onDiscard: () => void
  onScore: () => void
  onNext: () => void
}

/** Step 5: watch the take back, see what went wrong, then keep it (download / cloud), share it, or go again. */
export default function RecordReview(p: ReviewProps) {
  const { take, analysis } = p
  const here = useRouterState({ select: (s) => s.location.href })
  const src = useObjectUrl(take.blob)
  const [title, setTitle] = useState(p.defaultTitle)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const vtt = useMemo(
    () =>
      analysis?.cues.length
        ? new Blob([toVtt(analysis.cues)], { type: 'text/vtt' })
        : null,
    [analysis],
  )
  const vttUrl = useObjectUrl(vtt)

  const save = (href: string, name: string) => {
    const a = document.createElement('a')
    a.href = href
    a.download = name
    document.body.append(a)
    a.click()
    a.remove()
  }
  const download = () => {
    if (!src) return
    save(src, downloadName(take))
    track('record_download', { ext: extensionFor(take.mime) })
    p.onDownload()
  }

  const busy =
    p.job &&
    p.job.status !== 'done' &&
    p.job.status !== 'failed' &&
    !p.job.waiting
  const shareId = p.job?.status === 'done' ? p.job.recordingId : null
  // Server captions (aligned by the worker) win over the VTT built on this device.
  const saved = useRecording(shareId).data
  const captions = chooseCaptions({
    captionsUrl: saved?.captions_url,
    captionsSource: saved?.captions_source,
    localCues: analysis?.cues,
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6 text-left">
      <header>
        <h2 className="font-display text-2xl font-bold">Your take</h2>
        <p className="text-sm text-muted-foreground">
          {formatClock(take.durationMs)} · {formatBytes(take.blob.size)} ·{' '}
          {take.width}×{take.height}
          {take.recovered && ' · recovered'}
        </p>
        {ENDED_NOTICE[take.endedReason] && (
          <p role="status" className="mt-2 text-sm text-cyan">
            {ENDED_NOTICE[take.endedReason]}
          </p>
        )}
      </header>

      {src ? (
        <ReviewPlayer
          src={src}
          durationMs={take.durationMs}
          markers={analysis?.markers ?? []}
          cues={captions.kind === 'local' ? analysis?.cues : undefined}
          captionsSrc={
            captions.kind === 'server'
              ? captions.url
              : captions.kind === 'local'
                ? vttUrl
                : null
          }
          initialMirror={
            take.hasCamera &&
            !take.hasScreen &&
            take.layoutSettings.mirror !== true
          }
        />
      ) : (
        <div
          className="aspect-video animate-pulse rounded-2xl bg-card"
          aria-hidden
        />
      )}

      {p.pending && (
        <p role="status" className="text-center text-sm text-muted-foreground">
          Checking what you said…
        </p>
      )}

      {analysis?.scored ? (
        <ResultCard
          score={analysis.score}
          accuracy={analysis.accuracy}
          wpm={analysis.wpm}
          xp={p.xp}
          onRetry={p.onReRecord}
          onNext={p.onNext}
        >
          <WordBreakdown
            display={analysis.display}
            statuses={analysis.statuses}
            rows={analysis.rows}
          />
        </ResultCard>
      ) : (
        !p.pending && (
          <section className="glass rounded-2xl p-4 text-center text-sm">
            <p className="text-muted-foreground">
              This take was paced by the guide, so we didn’t listen for
              mistakes. Want a score?
            </p>
            <Button className="mt-3" variant="outline" onClick={p.onScore}>
              <Mic className="mr-1.5 size-4" aria-hidden />
              Try Speak &amp; score
            </Button>
          </section>
        )
      )}

      {p.hints &&
        (p.hints.pace || p.hints.longestPauseS || p.hints.fillers > 0) && (
          <section
            aria-label="Delivery"
            className="glass rounded-2xl p-4 text-sm"
          >
            <h3 className="mb-1 font-semibold">How it sounded</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {p.hints.pace && <li>{p.hints.pace}</li>}
              {p.hints.longestPauseS && (
                <li>Longest pause: {p.hints.longestPauseS} s.</li>
              )}
              {p.hints.fillers > 0 && (
                <li>
                  {p.hints.fillers} filler{' '}
                  {p.hints.fillers === 1 ? 'word' : 'words'} (um, uh…).
                </li>
              )}
            </ul>
          </section>
        )}

      <section
        aria-label="Keep this take"
        className="glass space-y-4 rounded-2xl p-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={download} disabled={!src}>
            <Download className="mr-1.5 size-4" aria-hidden />
            Download
          </Button>
          {vttUrl && (
            <Button
              variant="outline"
              onClick={() =>
                save(vttUrl, downloadName(take).replace(/\.[a-z0-9]+$/, '.vtt'))
              }
            >
              <FileText className="mr-1.5 size-4" aria-hidden />
              Captions (.vtt)
            </Button>
          )}
          <Button variant="outline" onClick={p.onReRecord}>
            <RotateCcw className="mr-1.5 size-4" aria-hidden />
            Record again
          </Button>
          <Button
            variant="outline"
            className="hover:border-pink"
            onClick={() => setConfirmDiscard(true)}
          >
            <Trash2 className="mr-1.5 size-4" aria-hidden />
            Discard
          </Button>
        </div>

        {p.access === 'need_age' || p.access === 'ok' ? (
          <div className="space-y-2 border-t border-border pt-3">
            {!p.job || p.job.status === 'failed' ? (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  p.onSave(title)
                }}
              >
                <label className="min-w-0 flex-1 text-sm">
                  <span className="mb-1 block font-semibold">Title</span>
                  <input
                    value={title}
                    maxLength={80}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-xl border border-input bg-card px-3 py-2"
                  />
                </label>
                <Button type="submit" disabled={busy}>
                  <CloudUpload className="mr-1.5 size-4" aria-hidden />
                  Save to my account
                </Button>
              </form>
            ) : null}
            {p.job && (
              <UploadStatusChip job={p.job} onRetry={p.onRetryUpload} />
            )}
            {shareId && <SavedRecordingStatus recordingId={shareId} />}
            {p.canShare && shareId && (
              <Button variant="outline" onClick={() => p.onShare(shareId)}>
                <Share2 className="mr-1.5 size-4" aria-hidden />
                Share
              </Button>
            )}
            {p.quota && <StorageMeter quota={p.quota} />}
          </div>
        ) : p.access === 'sign_in' ? (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            <Link to="/login" search={{ redirect: here }} className="underline">
              Sign in
            </Link>{' '}
            to keep recordings in your account and share them. This take stays
            on this device for 24 hours.
          </p>
        ) : p.access === 'blocked_minor' ? (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            Recordings stay on this device for accounts under 13. Download it to
            keep it.
          </p>
        ) : null}
      </section>

      <Dialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard this take?"
        description="It will be deleted from this device. This can’t be undone."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDiscard(false)}>
            Keep it
          </Button>
          <Button
            onClick={() => {
              setConfirmDiscard(false)
              p.onDiscard()
            }}
          >
            Discard
          </Button>
        </div>
      </Dialog>
    </div>
  )
}
