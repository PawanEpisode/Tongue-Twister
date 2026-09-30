import { describe, expect, it } from 'vitest'
import { detectCapabilities, detectPlatform, supportFor } from './capabilities'
import type { CapabilityEnv } from './capabilities'

const fn = () => undefined
const chromeDesktop: CapabilityEnv = {
  navigator: {
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
    maxTouchPoints: 0,
    mediaDevices: { getUserMedia: fn, getDisplayMedia: fn },
    wakeLock: {},
    storage: { estimate: fn },
  },
  MediaRecorder: fn,
  HTMLCanvasElement: { prototype: { captureStream: fn } },
  AudioContext: fn,
  RestrictionTarget: {},
  indexedDB: {},
}
const withUa = (
  userAgent: string,
  over: Partial<CapabilityEnv> = {},
): CapabilityEnv => ({
  ...chromeDesktop,
  navigator: { ...chromeDesktop.navigator, userAgent },
  ...over,
})

describe('detectPlatform', () => {
  it('recognises phones, tablets that pose as Macs, and desktops', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe(
      'ios',
    )
    expect(
      detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 5),
    ).toBe('ios')
    expect(
      detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 0),
    ).toBe('desktop')
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe(
      'android',
    )
  })
})

describe('capability matrix (08 §6)', () => {
  const caps = detectCapabilities(chromeDesktop)
  it('Chromium desktop gets every layout, including element capture', () => {
    expect(caps.elementCapture).toBe('restriction')
    expect(
      supportFor(caps, { camera: true, screen: true, canvas: true }).ok,
    ).toBe(true)
    expect(
      supportFor(caps, { camera: false, screen: true, region: true }).ok,
    ).toBe(true)
  })
  it('falls back to Region Capture when only CropTarget exists', () => {
    const c = detectCapabilities({
      ...chromeDesktop,
      RestrictionTarget: undefined,
      CropTarget: {},
    })
    expect(c.elementCapture).toBe('crop')
  })
  it('Firefox / Safari desktop: screen yes, region no', () => {
    const c = detectCapabilities(
      withUa('Mozilla/5.0 (Macintosh) Gecko/20100101 Firefox/130.0', {
        RestrictionTarget: undefined,
      }),
    )
    expect(c.chromium).toBe(false)
    expect(supportFor(c, { camera: true, screen: true }).ok).toBe(true)
    const region = supportFor(c, { camera: false, screen: true, region: true })
    expect(region.ok).toBe(false)
  })
  it('iOS Safari: camera layouts only, no screen, no region', () => {
    const c = detectCapabilities(
      withUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari', {
        RestrictionTarget: undefined,
      }),
    )
    expect(c.platform).toBe('ios')
    expect(
      supportFor(c, { camera: true, screen: false, canvas: true }).ok,
    ).toBe(true)
    const screen = supportFor(c, { camera: true, screen: true })
    expect(screen).toEqual({
      ok: false,
      reason: 'Screen recording is desktop-only.',
    })
    expect(
      supportFor(c, { camera: false, screen: true, region: true }).ok,
    ).toBe(false)
  })
  it('Android Chrome: element capture stays hidden on phones', () => {
    const c = detectCapabilities(
      withUa(
        'Mozilla/5.0 (Linux; Android 14) Chrome/126.0 Mobile Safari/537.36',
      ),
    )
    expect(c.platform).toBe('android')
    expect(c.chromium).toBe(true)
    expect(c.elementCapture).toBeNull()
  })
  it('no MediaRecorder hides Record entirely (edge case 10)', () => {
    const c = detectCapabilities({ ...chromeDesktop, MediaRecorder: undefined })
    expect(c.canRecord).toBe(false)
    expect(supportFor(c, { camera: true, screen: false }).ok).toBe(false)
  })
  it('a missing canvas capture disables composited layouts but not camera-only', () => {
    const c = detectCapabilities({
      ...chromeDesktop,
      HTMLCanvasElement: { prototype: {} },
    })
    expect(
      supportFor(c, { camera: true, screen: false, canvas: true }).ok,
    ).toBe(false)
    expect(supportFor(c, { camera: true, screen: false }).ok).toBe(true)
  })
  it('an empty environment (server render) supports nothing and does not throw', () => {
    expect(detectCapabilities({}).canRecord).toBe(false)
  })
})
