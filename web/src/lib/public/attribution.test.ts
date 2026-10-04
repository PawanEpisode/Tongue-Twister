import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureArrival,
  markAttributionSent,
  pendingAttribution,
  rememberIntent,
} from './attribution'

describe('attribution', () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => void data.set(k, v),
      },
    })
  })

  it('keeps the first arrival, cleans the tags and never overwrites', () => {
    captureArrival(
      '/twisters/fat-frogs',
      '?utm_source=Twitter%20X&utm_medium=social&utm_campaign=Launch_1',
    )
    captureArrival('/privacy', '?utm_source=other')
    const a = pendingAttribution()
    expect(a?.first_path).toBe('/twisters/fat-frogs')
    expect(a?.utm).toEqual({
      source: 'twitterx',
      medium: 'social',
      campaign: 'launch_1',
    })
  })
  it('records the intent and is sent once', () => {
    captureArrival('/', '')
    rememberIntent('save_demo')
    expect(pendingAttribution()?.intent).toBe('save_demo')
    markAttributionSent()
    expect(pendingAttribution()).toBeNull()
  })
})
