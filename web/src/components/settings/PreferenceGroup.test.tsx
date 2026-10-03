// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import * as prefsModule from '#/lib/preferences'
import { ThemeProvider } from '#/lib/theme'
import { SETTING_GROUPS } from '#/lib/settings/schema'
import PreferenceGroup from './PreferenceGroup'

const accessibility = SETTING_GROUPS.find((g) => g.id === 'accessibility')!
const readAlong = SETTING_GROUPS.find((g) => g.id === 'read-along')!

function mockPrefs(
  over: Partial<ReturnType<typeof prefsModule.usePreferences>> = {},
) {
  const update = vi.fn()
  vi.spyOn(prefsModule, 'usePreferences').mockReturnValue({
    prefs: prefsModule.DEFAULT_PREFERENCES,
    update,
    sync: 'synced',
    ready: true,
    loaded: true,
    retry: vi.fn(),
    ...over,
  })
  return update
}

const wrap = (ui: ReactNode) => render(<ThemeProvider>{ui}</ThemeProvider>)

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PreferenceGroup', () => {
  it('saves a toggle through the shared preferences', () => {
    const update = mockPrefs()
    wrap(<PreferenceGroup group={accessibility} />)
    fireEvent.click(screen.getByRole('switch', { name: /high contrast/i }))
    expect(update).toHaveBeenCalledWith({ high_contrast: true })
  })

  it('disables every control when locked', () => {
    mockPrefs()
    wrap(<PreferenceGroup group={accessibility} disabled />)
    for (const sw of screen.getAllByRole('switch'))
      expect((sw as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders nothing interactive until preferences have loaded', () => {
    mockPrefs({ ready: false })
    wrap(<PreferenceGroup group={accessibility} />)
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('pace: automatic by default, and choosing a pace sets wpm', () => {
    const update = mockPrefs()
    wrap(<PreferenceGroup group={readAlong} />)
    expect(screen.getByText('Automatic')).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: /pace automatically/i }))
    expect(update).toHaveBeenCalledWith({ wpm: expect.any(Number) })
  })
})
