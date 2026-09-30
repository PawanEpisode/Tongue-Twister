import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'

const CHANNEL = 'twister-practice'
const BEAT_MS = 2000 // the tab that practises keeps announcing itself…
const STALE_MS = 5000 // …and a silent tab (crash, frozen) stops blocking after this long

type Lock = { blocked: boolean; claim: () => void; release: () => void }
const NO_LOCK: Lock = {
  blocked: false,
  claim: () => undefined,
  release: () => undefined,
}
const Ctx = createContext<Lock>(NO_LOCK)

/**
 * Only one tab may practise at a time (double mic capture, duplicate attempts — PRD 01 §8.2).
 * Tabs talk over BroadcastChannel; where it's unavailable the lock silently never blocks.
 */
export function PracticeLockProvider({ children }: { children: ReactNode }) {
  const [blocked, setBlocked] = useState(false)
  const tab = useRef(
    typeof crypto === 'undefined' ? 'tab' : crypto.randomUUID(),
  )
  const channel = useRef<BroadcastChannel | null>(null)
  const seen = useRef(new Map<string, number>()) // other tab → last heartbeat
  const beat = useRef<ReturnType<typeof setInterval>>(undefined)

  const recompute = useCallback(() => {
    const cutoff = Date.now() - STALE_MS
    for (const [id, at] of seen.current)
      if (at < cutoff) seen.current.delete(id)
    setBlocked(seen.current.size > 0)
  }, [])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const ch = new BroadcastChannel(CHANNEL)
    channel.current = ch
    ch.onmessage = ({
      data,
    }: MessageEvent<{ type: 'active' | 'release'; tab: string }>) => {
      if (data.type === 'active') seen.current.set(data.tab, Date.now())
      else seen.current.delete(data.tab)
      recompute()
    }
    const sweep = setInterval(recompute, BEAT_MS)
    return () => {
      clearInterval(sweep)
      clearInterval(beat.current)
      ch.postMessage({ type: 'release', tab: tab.current })
      ch.close()
      channel.current = null
    }
  }, [recompute])

  const claim = useCallback(() => {
    const announce = () =>
      channel.current?.postMessage({ type: 'active', tab: tab.current })
    clearInterval(beat.current)
    announce()
    beat.current = setInterval(announce, BEAT_MS)
  }, [])
  const release = useCallback(() => {
    clearInterval(beat.current)
    channel.current?.postMessage({ type: 'release', tab: tab.current })
  }, [])

  const value = useMemo(
    () => ({ blocked, claim, release }),
    [blocked, claim, release],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const usePracticeLock = () => useContext(Ctx)
