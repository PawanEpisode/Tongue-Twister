// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __reset,
  __setLoader,
  initAnalytics,
  setAnalyticsOptOut,
  track,
} from './analytics'
import { OPT_OUT_KEY } from './consent'

const fake = () => ({
  init: vi.fn(),
  capture: vi.fn(),
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
  reset: vi.fn(),
})
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  __reset()
  window.localStorage.clear()
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  Object.defineProperty(navigator, 'doNotTrack', {
    value: null,
    configurable: true,
  })
})

describe('analytics', () => {
  it('without a key: never loads posthog, never touches the network', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '')
    const loader = vi.fn()
    __setLoader(loader)
    initAnalytics()
    track('practice_started', { mode: 'speak_score' })
    await flush()
    expect(loader).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('with a key: cookieless config, queued events flush, props are sanitised', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test')
    vi.stubEnv('VITE_POSTHOG_HOST', 'https://ph.example')
    const ph = fake()
    __setLoader(() => Promise.resolve({ default: ph as never }))
    initAnalytics()
    track('attempt_completed', {
      kind: 'test',
      score_band: '50-79',
      transcript: 'x',
    } as never)
    await flush()
    expect(ph.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://ph.example',
        persistence: 'memory',
        autocapture: false,
        disable_session_recording: true,
        respect_dnt: true,
      }),
    )
    expect(ph.capture).toHaveBeenCalledWith('attempt_completed', {
      kind: 'test',
      score_band: '50-79',
    })
    track('score_card_shared')
    expect(ph.capture).toHaveBeenLastCalledWith('score_card_shared', {})
  })

  it('honours Do Not Track: nothing is loaded', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test')
    Object.defineProperty(navigator, 'doNotTrack', {
      value: '1',
      configurable: true,
    })
    const loader = vi.fn()
    __setLoader(loader)
    initAnalytics()
    track('score_card_shared')
    await flush()
    expect(loader).not.toHaveBeenCalled()
  })

  it('honours the stored opt-out, and opting out mid-session stops capture', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test')
    window.localStorage.setItem(OPT_OUT_KEY, '1')
    const loader = vi.fn()
    __setLoader(loader)
    initAnalytics()
    await flush()
    expect(loader).not.toHaveBeenCalled()

    window.localStorage.clear()
    const ph = fake()
    __setLoader(() => Promise.resolve({ default: ph as never }))
    initAnalytics()
    await flush()
    setAnalyticsOptOut(true)
    expect(ph.opt_out_capturing).toHaveBeenCalled()
    track('score_card_shared')
    expect(ph.capture).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(OPT_OUT_KEY)).toBe('1')
    setAnalyticsOptOut(false)
    expect(ph.opt_in_capturing).toHaveBeenCalled()
  })

  it('a failed load never throws', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test')
    __setLoader(() => Promise.reject(new Error('blocked')))
    initAnalytics()
    track('score_card_shared')
    await flush()
  })
})
