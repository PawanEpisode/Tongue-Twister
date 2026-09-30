import { describe, expect, it } from 'vitest'
import { canShare, saveAccess } from './cloudGate'

const on = { record_cloud: true, share_links: true }
describe('cloud gate', () => {
  it('shows nothing about the cloud when the flag is off', () => {
    expect(
      saveAccess({
        flags: { record_cloud: false },
        signedIn: true,
        ageBand: '13plus',
      }),
    ).toBe('hidden')
    expect(saveAccess({ flags: {}, signedIn: false, ageBand: undefined })).toBe(
      'hidden',
    )
  })
  it('guests are asked to sign in', () => {
    expect(saveAccess({ flags: on, signedIn: false, ageBand: undefined })).toBe(
      'sign_in',
    )
  })
  it('under-13 stays local; unknown age goes through the consent dialog first', () => {
    expect(saveAccess({ flags: on, signedIn: true, ageBand: 'under13' })).toBe(
      'blocked_minor',
    )
    expect(saveAccess({ flags: on, signedIn: true, ageBand: 'unknown' })).toBe(
      'need_age',
    )
    expect(saveAccess({ flags: on, signedIn: true, ageBand: undefined })).toBe(
      'need_age',
    )
    expect(saveAccess({ flags: on, signedIn: true, ageBand: '13plus' })).toBe(
      'ok',
    )
  })
  it('sharing needs the flag, an account and a confirmed 13+ owner', () => {
    expect(canShare({ flags: on, signedIn: true, ageBand: '13plus' })).toBe(
      true,
    )
    expect(
      canShare({
        flags: { share_links: false },
        signedIn: true,
        ageBand: '13plus',
      }),
    ).toBe(false)
    expect(canShare({ flags: on, signedIn: false, ageBand: '13plus' })).toBe(
      false,
    )
    expect(canShare({ flags: on, signedIn: true, ageBand: 'unknown' })).toBe(
      false,
    )
    expect(canShare({ flags: on, signedIn: true, ageBand: 'under13' })).toBe(
      false,
    )
  })
})
