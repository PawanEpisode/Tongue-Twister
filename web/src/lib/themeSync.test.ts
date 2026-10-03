import { describe, expect, it } from 'vitest'
import { decideThemeSync } from './themeSync'

describe('decideThemeSync', () => {
  it('seeds the account from an explicit local choice when the server is blank', () => {
    expect(
      decideThemeSync({ server: '', local: 'light', localExplicit: true }),
    ).toEqual({ kind: 'push', theme: 'light' })
  })
  it('does nothing when neither side ever chose', () => {
    expect(
      decideThemeSync({ server: '', local: 'dark', localExplicit: false }),
    ).toEqual({ kind: 'none' })
  })
  it('adopts the account theme when it differs', () => {
    expect(
      decideThemeSync({
        server: 'reading',
        local: 'dark',
        localExplicit: true,
      }),
    ).toEqual({ kind: 'adopt', theme: 'reading' })
  })
  it('does nothing when already equal', () => {
    expect(
      decideThemeSync({ server: 'dark', local: 'dark', localExplicit: false }),
    ).toEqual({ kind: 'none' })
  })
})
