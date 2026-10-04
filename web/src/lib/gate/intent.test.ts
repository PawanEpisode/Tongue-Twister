import { describe, expect, it } from 'vitest'
import { EVENT_RULES } from '#/lib/observability/events'
import { GATE_COPY } from './intent'
import { isInAppBrowser } from './inAppBrowser'

describe('gate', () => {
  it('has copy for exactly the intents the analytics allow-list knows', () => {
    expect(Object.keys(GATE_COPY).sort()).toEqual(
      [...EVENT_RULES.gate_shown.intent].sort(),
    )
  })
  it('keeps every sheet short', () => {
    for (const c of Object.values(GATE_COPY)) {
      expect(c.title.length).toBeLessThan(40)
      expect(c.body.length).toBeLessThan(140)
    }
  })
  it('spots in-app browsers where Google sign-in is refused', () => {
    expect(isInAppBrowser('Mozilla/5.0 Instagram 300.0')).toBe(true)
    expect(
      isInAppBrowser('Mozilla/5.0 (Macintosh) Chrome/120 Safari/537'),
    ).toBe(false)
  })
})
