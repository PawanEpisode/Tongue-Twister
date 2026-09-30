import { Loader2, ScanSearch, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { friendlyError } from '#/components/feedback'
import { Button } from '#/components/ui/button'
import type { Analysis, RecordingStatus } from '#/lib/api'
import { useAuth } from '#/lib/auth'
import { useFlags } from '#/lib/flags'
import { saveAccess } from '#/lib/record/cloudGate'
import { analysisStatus } from '#/lib/record/review'
import {
  useAnalyse,
  useConsentMutation,
  useConsents,
} from '#/lib/record/useRecordings'
import { CONSENT_VERSION } from '#/lib/api'
import { useMe } from '#/lib/useMe'
import ConsentDialog, { ANALYSIS_COPY } from './ConsentDialog'

/**
 * "Analyse my take" for a saved recording, with a status chip. Needs the cloud flag, a 13+ account and the
 * `voice_processing` consent (asked through the same dialog as saving).
 */
export default function AnalyseControl({
  recordingId,
  recordingStatus,
  analysis,
}: {
  recordingId: string
  recordingStatus: RecordingStatus
  analysis: Analysis | undefined
}) {
  const { session } = useAuth()
  const flags = useFlags()
  const me = useMe().data
  const consents = useConsents()
  const consentMut = useConsentMutation('voice_processing')
  const analyse = useAnalyse(recordingId)
  const [asking, setAsking] = useState(false)

  const access = saveAccess({
    flags,
    signedIn: !!session,
    ageBand: me?.age_band,
  })
  if (access !== 'ok' && access !== 'need_age') return null

  const status = analysisStatus({ analysis })
  if (status === 'queued' || status === 'running')
    return (
      <p
        role="status"
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Loader2
          className="size-4 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
        {status === 'queued'
          ? 'Waiting to analyse your take…'
          : 'Analysing your take…'}
      </p>
    )
  if (status === 'ready')
    return (
      <p role="status" className="flex items-center gap-1.5 text-sm text-lime">
        <ScanSearch className="size-4" aria-hidden />
        {analysis?.audio_ready ? 'Analysis ready' : 'Analysis finishing…'}
      </p>
    )
  if (recordingStatus !== 'ready' && recordingStatus !== 'processing')
    return null

  const start = () => {
    if (access === 'ok' && consents.hasAnalysisConsent) analyse.mutate()
    else setAsking(true)
  }

  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={start} disabled={analyse.isPending}>
          <ScanSearch className="mr-1.5 size-4" aria-hidden />
          {status === 'failed' ? 'Try analysing again' : 'Analyse my take'}
        </Button>
        {status === 'failed' && (
          <span role="status" className="flex items-center gap-1.5 text-pink">
            <TriangleAlert className="size-4" aria-hidden />
            The analysis didn’t finish.
          </span>
        )}
      </div>
      {analyse.isError && (
        <p role="alert" className="text-pink">
          {friendlyError(analyse.error)}
        </p>
      )}
      <ConsentDialog
        open={asking}
        copy={ANALYSIS_COPY}
        askAge={access === 'need_age'}
        busy={consentMut.isPending}
        failed={consentMut.isError}
        onClose={() => setAsking(false)}
        onConfirm={(age) =>
          consentMut.mutate(
            { age, version: CONSENT_VERSION },
            {
              onSuccess: () => {
                setAsking(false)
                if (age !== 'under13') analyse.mutate()
              },
            },
          )
        }
      />
    </div>
  )
}
