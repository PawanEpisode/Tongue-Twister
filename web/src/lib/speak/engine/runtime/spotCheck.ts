/**
 * Sending the audio the server asked to verify (D34-D41). Three calls and one resumable upload; it runs after the
 * person already has their result, so nothing here can change or delay it: every failure is swallowed into an
 * outcome the caller may log. The clip never leaves the browser unless the server's own response asked for it.
 */
import { ApiError } from '../../../api'
import type { UploadInfo, VoiceClipGrant } from '../../../api'
import type { EncodedClip } from './wav'

export type SpotCheckApi = {
  createSpotCheckClip: (body: {
    attempt: number
    size_bytes: number
    duration_ms: number
  }) => Promise<VoiceClipGrant>
  completeVoiceClip: (id: string, checksum: string) => Promise<unknown>
  attachSpotCheck: (attemptId: number, voiceAssetId: string) => Promise<unknown>
}
export type TusUpload = (
  blob: Blob,
  grant: UploadInfo,
  signal?: AbortSignal,
) => Promise<void>

export type SpotCheckOutcome =
  | { sent: true }
  | {
      sent: false
      reason: 'declined' | 'expired' | 'upload_failed' | 'aborted' | 'error'
    }

const DECLINED = new Set([402, 403, 404, 409, 413, 429]) // consent/plan/limits/no open request: not worth retrying

export async function sendSpotCheck(
  deps: { api: SpotCheckApi; upload: TusUpload },
  args: {
    attemptId: number
    clip: EncodedClip
    expiresAt?: string | null
    now?: number
  },
  signal?: AbortSignal,
): Promise<SpotCheckOutcome> {
  if (args.expiresAt && Date.parse(args.expiresAt) <= (args.now ?? Date.now()))
    return { sent: false, reason: 'expired' }
  try {
    const grant = await deps.api.createSpotCheckClip({
      attempt: args.attemptId,
      size_bytes: args.clip.bytes.length,
      duration_ms: args.clip.durationMs,
    })
    if (signal?.aborted) return { sent: false, reason: 'aborted' }
    try {
      await deps.upload(
        new Blob([args.clip.bytes as BlobPart], { type: 'audio/wav' }),
        grant.upload,
        signal,
      )
    } catch {
      return {
        sent: false,
        reason: signal?.aborted ? 'aborted' : 'upload_failed',
      }
    }
    await deps.api.completeVoiceClip(grant.voice_asset_id, args.clip.sha256)
    await deps.api.attachSpotCheck(args.attemptId, grant.voice_asset_id)
    return { sent: true }
  } catch (err) {
    if (err instanceof ApiError)
      return {
        sent: false,
        reason: DECLINED.has(err.status) ? 'declined' : 'error',
      }
    return { sent: false, reason: 'error' }
  }
}

/** The real resumable upload (tus, same wiring as cloud recordings). tus-js-client loads only when needed. */
export const browserTusUpload: TusUpload = async (blob, grant, signal) => {
  const tus = await import('tus-js-client')
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(blob, {
      endpoint: grant.signed_url,
      headers: { authorization: `Bearer ${grant.token}`, 'x-upsert': 'false' },
      metadata: {
        bucketName: grant.bucket,
        objectName: grant.path,
        contentType: 'audio/wav',
        cacheControl: '3600',
      },
      chunkSize: grant.chunk_size,
      retryDelays: [0, 1000, 3000],
      removeFingerprintOnSuccess: true,
      onError: reject,
      onSuccess: () => resolve(),
    })
    signal?.addEventListener('abort', () => {
      void upload.abort(true)
      reject(new Error('aborted'))
    })
    upload.start()
  })
}
