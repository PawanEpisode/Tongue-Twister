// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPT_OUT_KEY } from '#/lib/observability/consent'
import PrivacySection from './PrivacySection'

vi.mock('#/lib/observability/analytics', async () => {
  const consent = await import('#/lib/observability/consent')
  return { setAnalyticsOptOut: (v: boolean) => consent.setOptedOut(v) }
})
afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('PrivacySection', () => {
  it('is on by default and the switch stores the opt-out', () => {
    render(<PrivacySection />)
    const sw = screen.getByRole('switch')
    expect(sw.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(sw)
    expect(window.localStorage.getItem(OPT_OUT_KEY)).toBe('1')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    expect(window.localStorage.getItem(OPT_OUT_KEY)).toBeNull()
  })
})
