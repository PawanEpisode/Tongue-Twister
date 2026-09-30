import { useEffect, useState } from 'react'
import { detectCapabilities } from './capabilities'

/**
 * Whether this browser can record at all. The server and the first client render both say "yes" (so the markup
 * matches and hydration is clean); the real answer arrives after mount and hides the Record tab when it is no.
 */
export function useRecordSupport(): boolean {
  const [ok, setOk] = useState(true)
  useEffect(() => setOk(detectCapabilities().canRecord), [])
  return ok
}
