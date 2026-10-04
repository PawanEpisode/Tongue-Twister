import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import type { GateIntent } from './intent'

/** A person who dismissed the sheet this many times gets a quiet inline nudge instead of another modal. */
export const MAX_DISMISSALS = 2

type Request = { intent: GateIntent; returnTo?: string }
type Gate = {
  /** Open the sign-in sheet because the visitor tried to do something that needs an account. */
  request: (r: Request) => void
  open: Request | null
  /** After two dismissals the sheet gives way to a small inline nudge. */
  nudge: Request | null
  dismiss: () => void
  proceed: () => string
}

const Ctx = createContext<Gate | null>(null)
const KEY = 'twister.gate.dismissed'

const dismissals = () => {
  try {
    return Number(window.sessionStorage.getItem(KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

export function GateProvider({ children }: { children: ReactNode }) {
  const here = useRouterState({ select: (s) => s.location.href })
  const [open, setOpen] = useState<Request | null>(null)
  const [nudge, setNudge] = useState<Request | null>(null)

  const request = useCallback(
    (r: Request) => {
      const req = { ...r, returnTo: r.returnTo ?? here }
      if (dismissals() >= MAX_DISMISSALS) {
        setNudge(req)
        return
      }
      setOpen(req)
    },
    [here],
  )
  const dismiss = useCallback(() => {
    try {
      window.sessionStorage.setItem(KEY, String(dismissals() + 1))
    } catch {
      /* storage blocked: the sheet just keeps opening, which is fine */
    }
    setOpen(null)
    setNudge(null)
  }, [])
  const proceed = useCallback(() => {
    const req = open ?? nudge
    setOpen(null)
    setNudge(null)
    return req?.returnTo ?? '/twisters'
  }, [open, nudge])

  const value = useMemo(
    () => ({ request, open, nudge, dismiss, proceed }),
    [request, open, nudge, dismiss, proceed],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

const fallback: Gate = {
  request: () => undefined,
  open: null,
  nudge: null,
  dismiss: () => undefined,
  proceed: () => '/twisters',
}
/** Analytics and attribution for the sheet live in the lazily loaded sheet itself (see GateSheet). */
export const useGate = () => useContext(Ctx) ?? fallback
