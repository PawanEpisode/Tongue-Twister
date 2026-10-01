import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../auth'
import { invalidateProgress } from '../progress/invalidate'
import { hasPendingUploads } from './pendingUploads'
import type { UploadJob, UploadManager } from './uploadManager'

const EMPTY: readonly UploadJob[] = []
const noopSubscribe = () => () => undefined

/**
 * The upload manager as React state. The manager (and tus-js-client) load on demand: only when there is
 * something to upload or resume, never on a plain page view. Also resumes unfinished uploads after a reload
 * and refreshes the recordings list / storage meter whenever an upload finishes.
 */
export function useUploads(opts: { load?: boolean } = {}) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const owner = session?.user.id
  const [manager, setManager] = useState<UploadManager | null>(null)
  const doneSeen = useRef(new Set<string>())

  const wanted = opts.load || (owner ? hasPendingUploads(owner) : false)
  useEffect(() => {
    if (!wanted || !owner || manager) return
    let live = true
    void import('./uploadBrowser').then(async (m) => {
      const mgr = await m.getUploadManager()
      if (!live) return
      mgr.resumePending(owner)
      setManager(mgr)
    })
    return () => {
      live = false
    }
  }, [wanted, owner, manager])

  const jobs = useSyncExternalStore(
    manager ? manager.subscribe : noopSubscribe,
    manager ? manager.getSnapshot : () => EMPTY,
    () => EMPTY,
  )

  useEffect(() => {
    for (const j of jobs)
      if (j.status === 'done' && !doneSeen.current.has(j.id)) {
        doneSeen.current.add(j.id)
        void qc.invalidateQueries({ queryKey: ['recordings'] })
        void qc.invalidateQueries({ queryKey: ['storage'] })
        // A saved recording can unlock "On Camera"; it arrives via the summary's unseen list.
        void invalidateProgress(qc)
      }
  }, [jobs, qc])

  return {
    manager,
    jobs: owner ? jobs.filter((j) => j.owner === owner) : EMPTY,
  }
}
