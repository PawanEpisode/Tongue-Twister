import { describe, expect, it } from 'vitest'
import { timezoneToSync } from './timezone'

describe('timezoneToSync', () => {
  it('sends the browser zone while the profile is still on UTC', () => {
    expect(timezoneToSync('UTC', 'Asia/Kolkata', false)).toBe('Asia/Kolkata')
  })
  it('does nothing once synced on this device', () => {
    expect(timezoneToSync('UTC', 'Asia/Kolkata', true)).toBeNull()
  })
  it('respects a zone that was already chosen', () => {
    expect(timezoneToSync('Europe/Paris', 'Asia/Kolkata', false)).toBeNull()
  })
  it('does nothing when the browser is on UTC too, or unknown', () => {
    expect(timezoneToSync('UTC', 'UTC', false)).toBeNull()
    expect(timezoneToSync('UTC', undefined, false)).toBeNull()
  })
  it('waits for the profile to load', () => {
    expect(timezoneToSync(undefined, 'Asia/Kolkata', false)).toBeNull()
  })
})
