import { useEffect, useState } from 'react'

/** True once `active` has stayed true for `ms`; resets the moment it turns false. */
export function useAfter(active: boolean, ms: number): boolean {
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    if (!active) {
      setElapsed(false)
      return
    }
    const id = setTimeout(() => setElapsed(true), ms)
    return () => clearTimeout(id)
  }, [active, ms])
  return elapsed
}
