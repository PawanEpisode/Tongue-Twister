import { readJson, writeJson } from '#/lib/storage'
import type { GateIntentName } from '#/lib/observability/events'

/**
 * How a visitor first arrived and what pushed them to sign up, kept for the one-time
 * POST /me/attribution/ after sign-in. Only a site path, three campaign tags and a closed intent enum:
 * no ids, no free text (the API cleans them again).
 */
type Stored = {
  first_path: string
  utm: { source: string; medium: string; campaign: string }
  intent: GateIntentName
  sent: boolean
}
const KEY = 'twister.attribution.v1'
const blank = (): Stored => ({
  first_path: '',
  utm: { source: '', medium: '', campaign: '' },
  intent: 'direct',
  sent: false,
})
const tag = (v: string | null) =>
  (v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, 40)

/** First touch only: later pages never overwrite where the visitor came in. */
export function captureArrival(path: string, search: string) {
  const cur = readJson(KEY, blank)
  if (cur.first_path || cur.sent) return
  const q = new URLSearchParams(search)
  writeJson(KEY, {
    ...cur,
    first_path: path.slice(0, 120),
    utm: {
      source: tag(q.get('utm_source')),
      medium: tag(q.get('utm_medium')),
      campaign: tag(q.get('utm_campaign')),
    },
  })
}

export const rememberIntent = (intent: GateIntentName) =>
  writeJson(KEY, { ...readJson(KEY, blank), intent })

/** What to send once; null when it was already sent. */
export function pendingAttribution() {
  const cur = readJson(KEY, blank)
  if (cur.sent) return null
  return { intent: cur.intent, first_path: cur.first_path, utm: cur.utm }
}
export const markAttributionSent = () =>
  writeJson(KEY, { ...readJson(KEY, blank), sent: true })
