import { CloudCheck, CloudUpload, RotateCw, TriangleAlert } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type { UploadJob } from '#/lib/record/uploadManager'

/** One line for an upload: progress while it runs, a retry chip when it stalls, a tick when it is done. */
export default function UploadStatusChip({
  job,
  onRetry,
}: {
  job: UploadJob
  onRetry: (id: string) => void
}) {
  if (job.status === 'done')
    return (
      <p role="status" className="flex items-center gap-1.5 text-sm text-lime">
        <CloudCheck className="size-4" aria-hidden />
        Saved to your account
      </p>
    )
  if (job.status === 'failed' || job.waiting)
    return (
      <div role="status" className="flex flex-wrap items-center gap-2 text-sm">
        <span className="flex items-center gap-1.5 text-pink">
          <TriangleAlert className="size-4" aria-hidden />
          {job.error?.message ?? 'Upload paused.'}
        </span>
        {(job.status === 'failed' || job.error?.retryable !== false) && (
          <Button size="sm" variant="outline" onClick={() => onRetry(job.id)}>
            <RotateCw className="mr-1 size-3.5" aria-hidden />
            Retry upload
          </Button>
        )}
      </div>
    )
  const pct = Math.round(job.progress * 100)
  return (
    <div role="status" className="space-y-1 text-sm">
      <p className="flex items-center gap-1.5 text-muted-foreground">
        <CloudUpload className="size-4" aria-hidden />
        {job.status === 'uploading'
          ? `Uploading… ${pct}%`
          : job.status === 'completing'
            ? 'Finishing…'
            : 'Getting ready…'}
      </p>
      <progress
        className="h-1.5 w-full accent-[var(--primary)]"
        max={100}
        value={pct}
        aria-label="Upload progress"
      />
    </div>
  )
}
