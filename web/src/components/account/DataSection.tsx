import { Download } from 'lucide-react'
import { friendlyError } from '#/components/feedback'
import { Button } from '#/components/ui/button'
import { useDataExport } from '#/lib/account/useDataExport'

export default function DataSection() {
  const exp = useDataExport()
  const csv = useDataExport('csv')
  return (
    <div className="space-y-3 text-sm">
      <p>
        Download a copy of your data as one JSON file: your profile and
        settings, favourites, attempts with word results, sessions, daily
        activity, stats, achievements, recording details and consents.
      </p>
      <p className="text-xs text-muted-foreground">
        Not included: audio and video files, other people’s data, and internal
        technical details. You can download up to 3 times an hour.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={exp.isPending}
          onClick={() => exp.mutate()}
        >
          <Download className="mr-1.5 size-4" aria-hidden />
          {exp.isPending
            ? 'Preparing your file…'
            : exp.isError
              ? 'Try again'
              : 'Export my data'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={csv.isPending}
          onClick={() => csv.mutate()}
        >
          <Download className="mr-1.5 size-4" aria-hidden />
          {csv.isPending
            ? 'Preparing…'
            : csv.isError
              ? 'Try again'
              : 'Attempts as spreadsheet (CSV)'}
        </Button>
        <span role="status" aria-live="polite" className="text-xs">
          {csv.isSuccess && (
            <span className="text-lime">Downloaded {csv.data}.</span>
          )}
          {csv.isError && (
            <span className="text-pink">{friendlyError(csv.error)}</span>
          )}
          {exp.isSuccess && (
            <span className="text-lime">Downloaded {exp.data}.</span>
          )}
          {exp.isError && (
            <span className="text-pink">{friendlyError(exp.error)}</span>
          )}
        </span>
      </div>
    </div>
  )
}
