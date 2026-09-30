/** Server state for saved recordings, storage, shares and plan limits (TanStack Query). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef } from 'react'
import { CONSENT_VERSION, api } from '../api'
import type {
  AgeBand,
  ConsentType,
  Profile,
  RecordingDetail,
  RecordingPatch,
  ShareExpiry,
} from '../api'
import { useAuth } from '../auth'
import { pickPlayback, pollDelay } from './review'
import type { PlaybackState } from './review'

/** Free-plan default (D1); replaced by the plan's `recording_ms_max` when the API reports it. */
export const DEFAULT_RECORDING_MS_MAX = 180_000

/** Free-plan retention (D1). */
export const DEFAULT_RETENTION_DAYS = 30

export function usePlanLimits() {
  const { session } = useAuth()
  const { data } = useQuery({
    queryKey: ['entitlements'],
    queryFn: api.entitlements,
    enabled: !!session,
    staleTime: 5 * 60_000,
  })
  const limits = data?.plan.limits
  return {
    recordingMsMax: limits?.recording_ms_max ?? DEFAULT_RECORDING_MS_MAX,
    shareMaxDays: limits?.share_max_days ?? 7,
    retentionDays: limits?.retention_days ?? DEFAULT_RETENTION_DAYS,
  }
}

export function useRecordingsList(
  opts: { twister?: string; enabled?: boolean } = {},
) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['recordings', 'list', opts.twister ?? null],
    queryFn: () => api.recordings({ twister: opts.twister }),
    enabled: !!session && (opts.enabled ?? true),
  })
}

export function useRecording(id: string | null) {
  return useQuery({
    queryKey: ['recordings', 'detail', id],
    queryFn: () => api.recording(id as string), // enabled only when id is set
    enabled: !!id,
    // Playback URLs are signed for 15 min; refetch a bit before that.
    staleTime: 10 * 60_000,
    // While the server is transcoding or analysing, poll with a back-off until it settles.
    refetchInterval: (q) => pollDelay(q.state.data, q.state.dataUpdateCount),
  })
}

/** The signed playback URL, kept steady across polls so the video does not restart mid-play. */
export function useStablePlayback(data: RecordingDetail | undefined) {
  const last = useRef<PlaybackState | null>(null)
  return useMemo(() => {
    if (!data) return null
    const next = { status: data.status, playback: data.playback }
    const playback = pickPlayback(last.current, next, Date.now())
    last.current = { status: data.status, playback }
    return playback
  }, [data])
}

/** "Analyse my take": queues the server job, then the detail poll follows it to `ready`. */
export function useAnalyse(recordingId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.analyseRecording(recordingId),
    onSuccess: ({ analysis }) => {
      qc.setQueryData<RecordingDetail>(
        ['recordings', 'detail', recordingId],
        (d) => (d ? { ...d, analysis } : d),
      )
      void qc.invalidateQueries({
        queryKey: ['recordings', 'detail', recordingId],
      })
    },
  })
}

/** Saves the opt-in public name and updates the shared `['me']` cache entry. */
export function usePublicName() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.setPublicName(name),
    onSuccess: (profile: Profile) => qc.setQueryData(['me'], profile),
  })
}

export function useStorage(enabled = true) {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['storage'],
    queryFn: api.storage,
    enabled: !!session && enabled,
    staleTime: 15_000,
  })
}

export function useRecordingMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['recordings'] })
    void qc.invalidateQueries({ queryKey: ['storage'] })
  }
  return {
    update: useMutation({
      mutationFn: (v: { id: string; patch: RecordingPatch }) =>
        api.updateRecording(v.id, v.patch),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: api.deleteRecording,
      onSuccess: refresh,
    }),
    restore: useMutation({
      mutationFn: api.restoreRecording,
      onSuccess: refresh,
    }),
  }
}

export function useShares(recordingId: string | null) {
  return useQuery({
    queryKey: ['shares', recordingId],
    queryFn: () => api.shares(recordingId as string),
    enabled: !!recordingId,
  })
}

export function useShareMutations(recordingId: string) {
  const qc = useQueryClient()
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ['shares', recordingId] })
  return {
    create: useMutation({
      mutationFn: (expires: ShareExpiry) =>
        api.shareRecording(recordingId, expires),
      onSuccess: refresh,
    }),
    revoke: useMutation({ mutationFn: api.revokeShare, onSuccess: refresh }),
  }
}

/** Age group + recording consent, in that order (the API rejects an upload without both). */
export function useConsentMutation(type: ConsentType = 'recording_upload') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: {
      age: Exclude<AgeBand, 'unknown'> | null
      version: string
    }) => {
      if (v.age) await api.setAgeBand(v.age)
      if (v.age !== 'under13') await api.grantConsent(type, v.version)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['consents'] })
    },
  })
}

/** Whether the current consent (this version) is on file, per type. */
export function useConsents() {
  const { session } = useAuth()
  const q = useQuery({
    queryKey: ['consents'],
    queryFn: api.consents,
    enabled: !!session,
    staleTime: 60_000,
  })
  const has = (type: ConsentType) =>
    q.data?.some(
      (c) => c.type === type && !c.revoked_at && c.version === CONSENT_VERSION,
    ) ?? false
  return {
    ...q,
    has,
    hasUploadConsent: has('recording_upload'),
    hasAnalysisConsent: has('voice_processing'),
  }
}
