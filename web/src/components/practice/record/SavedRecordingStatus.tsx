import { useRecording } from '#/lib/record/useRecordings'
import AnalyseControl from './AnalyseControl'

/** After a cloud save: "Preparing your video…" while the server transcodes, then the analysis action. */
export default function SavedRecordingStatus({
  recordingId,
}: {
  recordingId: string
}) {
  const { data } = useRecording(recordingId)
  if (!data) return null
  return (
    <div className="space-y-2">
      {data.status === 'processing' && (
        <p role="status" className="text-sm text-muted-foreground">
          Preparing your video…
        </p>
      )}
      <AnalyseControl
        recordingId={recordingId}
        recordingStatus={data.status}
        analysis={data.analysis}
      />
    </div>
  )
}
